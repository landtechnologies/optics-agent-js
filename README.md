# graphql-dog

**A tracking agent for apollo GraphQL servers, for logging to Datadog. Forked from Apollo Optics agent, and uses datadog-metrics.**

Unlike the original, this fork simply tracks `request_time`s (in ms), with datadog tags specifying the graphql type, field and 'type.field'.  There is no special error logging, or tracking of number of which fields are used etc.

**THIS IS NOT HEAVILY TESTED YET**

Here are the steps to enable Graphql-dog in your app. See below for details on each step:
* Install the NPM package in your app: `npm install ??? --save`
* Import the package in your main js file: `import GraphQLDog from 'graphql-dog';`
* Get an API key from the Optics web interface and configure the agent. Either:
  * Set the `DATADOG_API_KEY` environment variable to your API key
  * Set the datadog options using the `datadogOpts` field in `GraphQLDog.configureAgent({ options });`
* Instrument your app. In any order:
  * Instrument your schema: `GraphQLDog.instrumentSchema(executableSchema);`
  * Add the middleware: `expressServer.use(GraphQLDog.middleware());`
  * Add to your GraphQL context object: `context.datadogContext = GraphQLDog.context(req);`

## Version requirements

* Node 4, 5, 6 or 7
* [graphql-js](https://www.npmjs.com/package/graphql): 0.6.2 to 0.10.0.

## Install

First, install the package

```
npm install ?? --save
```

## Configure

Next, set up the agent in your main server file.

### Import the package

```js
var GraphQLDog = require('graphql-dog');
```

or in ES2015+

```js
import GraphQLDog from 'graphql-dog';
```

### [optional] Configure the Agent

```js
GraphQLDog.configureAgent({ configOptions })
```

Normally you do not need to call this function -- just set the `DATADOG_API_KEY` environment variable. Call this function if you set the API key in code instead of through the environment variable, or if you need to set specific non-default values for other options. Call this _before_ any calls to instrumentation functions below.

Options include:

* `apiKey`: String. Your API key for the Datadog service. This defaults to the `DATADOG_API_KEY` environment variable, but can be overridden here.

* `normalizeQuery`: Function([GraphQLResolveInfo](http://graphql.org/graphql-js/type/#graphqlobjecttype))⇒String. Called to determine the query shape for for a GraphQL query. You shouldn't need to set this unless you are debugging.

* `reportIntervalMs`: Number. How often to send reports in milliseconds. ..see `datadog-metrics` package for details.


### Instrument your schema

Call `instrumentSchema` on the same [executable schema object](http://graphql.org/graphql-js/type/#graphqlschema) you pass to the [`graphql` function from `graphql-js`](http://graphql.org/graphql-js/graphql/#graphql):

```js
GraphQLDog.instrumentSchema(executableSchema);
```

You should only call this once per agent. If you have multiple or dynamic schemas, create a separate agent per schema (see below).

### Add the middleware

Set up middleware:

#### Express

Tell your server to run the Optics Agent middleware:

```js
expressServer.use(GraphQLDog.middleware());
```

This must run before the handler that actually executes your GraphQL queries.  For the most accurate timings, avoid inserting unnecessary middleware between the Optics Agent middleware and your GraphQL middleware.

#### HAPI
Unlike Express (above) this has not been tested in this fork from optics-agent.

```js
GraphQLDog.instrumentHapiServer(hapiServer);
```

#### Koa
Unlike Express (above) this has not been tested in this fork of optics-agent - and indeed the original already carried a warning that Koa is not officially supported.

```js
const schema = OpticsAgent.instrumentSchema(executableSchema);
app.use(OpticsAgent.koaMiddleware());
router.post(
  '/graphql',
  graphqlKoa(async ctx => {
    // create an optic context
    const datadogContext = GraphQLDog.context(ctx.request);
    // create a context for each request
    const context = { datadogContext };
    return {
      schema,
      context,
    };
  })
);
```

### Add a context to each graphql request

Inside your request handler, if you are calling `graphql` directly, add a new
field to the `context` object sent to `graphql`:

```jsjs
{ datadogContext: GraphQLDog.context(req) }
```

If you are using `apolloExpress`, this will be a field on
the
[`context` object on the `ApolloOptions` value that you return](http://dev.apollodata.com/tools/apollo-server/setup.html#options-function).

If you are using HAPI you must explicitly use the raw request object:
```js
{ datadogContext: GraphQLDog.context(request.raw.req) }
```

## Advanced Usage
(Not tested in this fork.) If you need to have more than one Agent per process, you can manually construct an Agent object instead of using the default global Agent. Call `new GraphQLDog.Agent(options)` to instantiate the object, and then call methods directly on the object instead of on `GraphQLDog`. Here is an example:

```js
var GraphQLDog = require('graphql-dog');
var agent = new GraphQLDog.Agent({ apiKey: '1234' });
agent.instrumentSchema(schema);
```

## Troubleshooting

The agent is designed to allow your application to continue working, even if the agent is not configured properly.


