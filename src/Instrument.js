// This file contains the functions that interact with graphql-js to
// get the data for us to report.


import { forEachField, addSchemaLevelResolveFunction } from 'graphql-tools';

import { reportRequestStart, reportRequestEnd } from './Report';

const onFinished = require('on-finished');

// //////// Request Wrapping ////////

// Here we wrap HTTP requests coming in to the web server.

// On request start:
// 1) note the request start time
// 2) create a per-request place to put state

// On request end:
// 3) note the request stop time
// 4) send the collected data off to Report.js for processing

// This should be the only code that interacts with the web
// server. Supporting new web servers besides Express and HAPI should
// be contained here.

const preRequest = (req) => {
  const context = {
    req,
    startWallTime: +new Date(),
    startHrTime: process.hrtime(),
    resolverCalls: [],
  };
  req._datadogContext = context;  // eslint-disable-line no-param-reassign
};

const postRequest = (req) => {
  const context = req._datadogContext;
  // context should always be set, but double check just in case.
  //
  // XXX consider error reporting. We might not want to `console.log`
  // here, as it is potentially in a critical path and getting called
  // a lot. maybe a `warnOnce` function that prints the first time it
  // happens and not repeatedly?
  //
  // See also:
  // https://github.com/apollostack/optics-agent-js/issues/6
  if (context) {
    context.durationHrTime = process.hrtime(context.startHrTime);
    context.endWallTime = +new Date();

    // put reporting later in the event loop after I/O, so hopefully we
    // don't impact latency as much.
    setImmediate(() => { reportRequestEnd(req); });
  }
};

export const opticsMiddleware = (req, res, next) => {
  preRequest(req);
  onFinished(res, (_err, _res) => {
    postRequest(req);
  });

  return next();
};

export const koaMiddleware = (ctx, next) => {
  preRequest(ctx.request);

  return next().then(() => postRequest(ctx.request));
};

export const instrumentHapiServer = (server) => {
  server.ext([
    {
      type: 'onPreHandler',
      method: (request, reply) => {
        const req = request.raw.req;
        preRequest(req);
        return reply.continue();
      },
    }, {
      type: 'onPostHandler',
      method: (request, reply) => {
        const req = request.raw.req;
        postRequest(req);
        return reply.continue();
      },
    }]);
};


// //////// Resolver Wrapping ////////

// Here we wrap resolver functions. The wrapped resolver notes start
// and end times, resolvers that return null/undefined, and
// errors. Note that a resolver is not considered finished until all
// Promises it returns (if any) have completed.

// This is applied to each resolver in the schema by instrumentSchema
// below.

export const decorateField = (fn, fieldInfo) => {
  const decoratedResolver = (p, a, ctx, resolverInfo) => {
    // setup context and note start time.
    const datadogContext = ctx && ctx.datadogContext;

    if (!datadogContext) {
      // This happens when `instrumentSchema` was called, but
      // `newContext` didn't get put in the graphql context correctly.
      //
      // XXX we should report this error somehow, but logging once per
      // resolver is not good. Perhaps a "warn once" mechanism?

      return fn(p, a, ctx, resolverInfo);
    }

    const resolverReport = {
      startOffset: process.hrtime(datadogContext.startHrTime),
      fieldInfo,
      resolverInfo,
      resolverContext: ctx,
    };
    // save the report object for when we want to send query traces and to
    // aggregate its statistics at the end of the request.
    datadogContext.resolverCalls.push(resolverReport);

    // Call this when the resolver and all the Promises it returns
    // (if any) are complete.
    const finishRun = () => {
      // note end time.
      resolverReport.endOffset = process.hrtime(datadogContext.startHrTime);
    };

    // Actually run the resolver.
    let result;
    try {
      result = fn(p, a, ctx, resolverInfo);
    } catch (e) {
      // Resolver function threw during execution. Note the error and
      // re-throw.
      resolverReport.error = true;
      finishRun();
      throw e;
    }

    // Now process the results of the resolver.
    //
    // Resolver can return any of: null, undefined, string, number,
    // array[thing], or Promise[thing].
    // For primitives and arrays of primitives, fire the report immediately.
    // For Promises, fire when the Promise returns.
    // For arrays containing Promises, fire when the last Promise returns.
    //
    // Wrap in try-catch so bugs in optics-agent are less likely to break an
    // app.
    try {
      if (result === null) {
        resolverReport.resultNull = true;
      } else if (typeof result === 'undefined') {
        resolverReport.resultUndefined = true;
      } else if (typeof result.then === 'function') {
        // single Promise
        //
        // don’t throw from this promise, because it’s not one that the app
        // gets to handle, instead it operates on the original promise.
        result.then(finishRun).catch(() => {
          resolverReport.error = true;
          finishRun();
        });
        // exit early so we do not hit the default return.
        return result;
      } else if (Array.isArray(result)) {
        // array

        // collect the Promises in the array, if any.
        const promises = [];
        result.forEach((value) => {
          if (value && typeof value.then === 'function') {
            promises.push(value);
          }
        });
        // if there are Promises in the array, fire when they are all done.
        if (promises.length > 0) {
          // don’t throw from this promise, because it’s not one that the app
          // gets to handle, instead it operates on the original promise.
          Promise.all(promises).then(finishRun).catch(() => {
            resolverReport.error = true;
            finishRun();
          });
          // exit early so we do not hit the default return.
          return result;
        }
      } else {
        // primitive type. do nothing special, just default return.
      }

      // default return for non-Promise answers
      finishRun();
      return result;
    } catch (e) {
      // safety belt.
      // XXX log here!
      return result;
    }
  };

  // Add .$proxy to support graphql-sequelize.
  // See: https://github.com/mickhansen/graphql-sequelize/blob/edd4266bd55828157240fe5fe4d4381e76f041f8/src/generateIncludes.js#L37-L41
  decoratedResolver.$proxy = fn;

  return decoratedResolver;
};


// //////// Helpers ////////

// Copied from https://github.com/graphql/graphql-js/blob/v0.7.1/src/execution/execute.js#L1004
// with 'return undefined' added for clarity (and eslint)
function defaultResolveFn(source, args, context, { fieldName }) {
  // ensure source is a value for which property access is acceptable.
  if (typeof source === 'object' || typeof source === 'function') {
    const property = source[fieldName];
    if (typeof property === 'function') {
      return source[fieldName](args, context);
    }
    return property;
  }
  return undefined;
}


//  //////// Schema Wrapping ////////

// Here we take the executable schema object that graphql-js will
// execute against and add wrappings. We add both a per-schema
// wrapping that runs once per query and a per-resolver wrapping that
// runs around every resolver invocation.

export const instrumentSchema = (schema) => {
  if (schema._opticsInstrumented) {
    return schema;
  }
  schema._opticsInstrumented = true;  // eslint-disable-line no-param-reassign

  // add per field instrumentation
  forEachField(schema, (field, typeName, fieldName) => {
    // If there is no resolver for a field, add the default resolve
    // function (which matches the behavior of graphql-js when there
    // is no explicit resolve function). This way we can instrument
    // it.
    if (!field.resolve) {
      field.resolve = defaultResolveFn; // eslint-disable-line no-param-reassign
    }

    field.resolve = decorateField(  // eslint-disable-line no-param-reassign
      field.resolve,
      { typeName, fieldName },
    );
  });

  // add per query instrumentation
  addSchemaLevelResolveFunction(schema, (root, args, ctx, info) => {
    const datadogContext = ctx.datadogContext;
    if (datadogContext) {
      reportRequestStart(datadogContext, info, ctx);
    }
    return root;
  });

  return schema;
};


// //////// Glue ////////


// The graphql `context` object is how we get state into the resolver
// wrappers. For resolver level information gathering to work, the
// user must call `newContext` once per query and place the return
// value in the `datadogContext` field of the graphql-js `context`
// argument.
export const newContext = (req, agent) => {
  let context = req._datadogContext;
  if (!context) {
    // This happens if the middleware isn't run correctly.

    // XXX this will print once per request! Maybe add a "warn once"
    // feature to print only once.
    agent.debugFn('Optics context not found. Make sure Optics middleware is installed.');

    // Fix things up by re-running the pre-request hook. We probably
    // won't correctly send a report as the post-request hook
    // probably won't fire, but this way optics code that assumes a
    // context will run correctly.
    preRequest(req);
    context = req._datadogContext;
  }

  // This does not really need to be set here. It could be set in
  // preRequest, if we threaded agent through there. Once we do that,
  // we could change the API to not require calling this as a function
  // and instead just ask users to add `req.datadogContext` to their
  // graphql context. See:
  // https://github.com/apollostack/optics-agent-js/issues/46
  context.agent = agent;

  return context;
};
