import Agent from './Agent';
import { configureAgent, instrumentSchema, middleware,
         instrumentHapiServer, koaMiddleware, context } from './DefaultAgent';

// export both as individual symbols and as a default object to
// support both of these syntaxes:
//   import GraphQLDog from 'graphql-dog';
//   import { middleware, instrumentSchema } from 'graphql-dog';
//
// Or with CommonJS:
//   var GraphQLDog = require('graphql-dog');
export default {
  configureAgent,
  instrumentSchema,
  middleware,
  koaMiddleware,
  instrumentHapiServer,
  context,
  Agent,
};

export {
  configureAgent,
  instrumentSchema,
  middleware,
  koaMiddleware,
  instrumentHapiServer,
  context,
  Agent,
};
