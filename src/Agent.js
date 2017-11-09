// This file contains the Agent class which is the public-facing API
// for this package.
//
// The Agent holds the configuration and all the in-memory state for
// the server.

import datadogMetrics from 'datadog-metrics';

import {
  normalizeQuery as defaultNQ, normalizeVersion as defaultNV,
} from './Normalize';

import {
  instrumentHapiServer,
  instrumentSchema,
  newContext,
  opticsMiddleware,
  koaMiddleware,
} from './Instrument';

import {
  reportSchema,
} from './Report';


export default class Agent {
  constructor(options) {
    // Public options. See README.md for descriptions.
    const {
      datadogOpts, debugFn, normalizeVersion, normalizeQuery,
      printReports, disabled,
    } = options || {};

    this.datadogOpts = datadogOpts;
    this.debugFn = debugFn || console.log; // eslint-disable-line no-console
    this.disabled = !!disabled;
    this.normalizeVersion = normalizeVersion || defaultNV;
    this.normalizeQuery = normalizeQuery || defaultNQ;
    this.printReports = !!printReports;
    this.datadog = datadogMetrics;
    this.datadog.init(datadogOpts || {});
  }

  instrumentSchema(schema) {
    if (this.disabled) {
      return schema;
    }
    this.schema = instrumentSchema(schema, this);
    reportSchema(this, schema);
    return this.schema;
  }

  koaMiddleware() {
    if (this.disabled) {
      return ((_ctx, next) => next());
    }

    return koaMiddleware;
  }

  middleware() {
    if (this.disabled) {
      return ((_req, _res, next) => { next(); });
    }
    return opticsMiddleware;
  }

  instrumentHapiServer(server) {
    if (this.disabled) {
      return;
    }
    instrumentHapiServer(server);
  }

  context(req) {
    if (this.disabled) {
      return {};
    }
    return newContext(req, this);
  }

  stop(handler) {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = false;
      this.sendStatsReport(handler);
    }
  }

}
