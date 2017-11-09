// Converts an hrtime array (as returned from process.hrtime) to nanoseconds.
//
// ONLY CALL THIS ON VALUES REPRESENTING DELTAS, NOT ON THE RAW RETURN VALUE
// FROM process.hrtime() WITH NO ARGUMENTS.
//
// The entire point of the hrtime data structure is that the JavaScript Number
// type can't represent all int64 values without loss of precision:
// Number.MAX_SAFE_INTEGER nanoseconds is about 104 days. Calling this function
// on a duration that represents a value less than 104 days is fine. Calling
// this function on an absolute time (which is generally roughly time since
// system boot) is not a good idea.
const durationHrTimeToMS = hrtime => ((hrtime[0] * 1e3) + (hrtime[1] / 1e6));


// Called once per query at query start time by graphql-js.
export const reportRequestStart = (context, queryInfo, queryContext) => {
  if (!context || !queryInfo || !context.agent) {
    // Happens when non-graphql requests come through.
    return;
  }

  // This may be called more than once per request, for example
  // apollo-server can batch multiple requests in a single POST (aka
  // Transport Level Batching).
  //
  // We keep track of each info object separately, along with the
  // `context` object passed to the query, and use these to determine
  // which resolver runs correspond to which query.
  //
  // Store as a Map of `context` => [ { info, context, resolvers } ] objects.
  //
  // This is a contract between reportRequestStart and reportRequestEnd.
  //
  // Note: we use a Map instead of simple array to avoid doing O(N^2)
  // work on a batch with a lot of queries, each with a separate
  // context object. We store a list in each map item in case the
  // caller does not allocate a new context object per query and we
  // see a duplicate context object.
  if (!context.queries) {
    context.queries = new Map(); // eslint-disable-line no-param-reassign
  }
  if (!context.queries.has(queryContext)) {
    context.queries.set(queryContext, []);
  }
  context.queries.get(queryContext).push({
    info: queryInfo,
    resolvers: [],
  });
};

// called once per query by the middleware when the request ends.
export const reportRequestEnd = (req) => {
  const context = req._datadogContext;
  if (!context || !context.queries || !context.agent) {
    // Happens when non-graphql requests come through.
    return;
  }

  const queries = context.queries;
  const agent = context.agent;

  try {
    // Separate out resolvers into buckets by query. To determine
    // which query a resolver corresponds to in the case of multiple
    // queries per HTTP request, we look at the GraphQL `context` and
    // `operation` objects which are available both at query start
    // time and during resolver runs.
    //
    // Implementations that do batching of GraphQL requests (such as
    // apollo-server) should use a separate `context` object for each
    // request in the batch. Shallow cloning is sufficient.
    //
    // For backwards compatibility with older versions of
    // apollo-server, and potentially with other graphql integrations,
    // we also look at the `operation` object. This will be different
    // for each query in the batch unless the application is using
    // pre-prepared queries and the user sends multiple queries for
    // the same operation in the same batch.
    (context.resolverCalls || []).forEach((resolverReport) => {
      // check the report is complete.
      if (!resolverReport.resolverInfo ||
          !resolverReport.resolverInfo.operation ||
          !resolverReport.fieldInfo ||
          !resolverReport.startOffset ||
          !resolverReport.endOffset) {
        return;
      }

      // eslint-disable-next-line no-restricted-syntax
      for (const queryObj of (queries.get(resolverReport.resolverContext) || [])) {
        if (resolverReport.resolverInfo.operation === queryObj.info.operation) {
          queryObj.resolvers.push(resolverReport);
          break;
        }
      }
    });

    // Iterate over each query in this request and aggregate its
    // timing and resolvers.
    queries.forEach((queryList) => {
      queryList.forEach(({ info, resolvers: queryResolvers = [] }) => {
        let durationMs = durationHrTimeToMS(context.durationHrTime);
        agent.datadog.histogram('graphql.root.request_time', durationMs, [`query:${info.fieldName}`]);

        // now iterate over our resolvers and add them to the latency buckets.
        queryResolvers.forEach((resolverReport) => {
          const { typeName, fieldName } = resolverReport.fieldInfo;
          if (resolverReport.endOffset && resolverReport.startOffset) {
            durationMs = durationHrTimeToMS(resolverReport.endOffset)
                         - durationHrTimeToMS(resolverReport.startOffset);
            agent.datadog.histogram('graphql.type.request_time', durationMs,
              [`type:${typeName}`, `field:${fieldName}`, `typeAndField:${typeName}.${fieldName}`]);
          }
        });
      });
    });
  } catch (e) {
    // XXX https://github.com/apollostack/optics-agent-js/issues/17
    console.log('GraphQLDog reportRequestEnd error', e);  // eslint-disable-line no-console
  }
};

