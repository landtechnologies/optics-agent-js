// This file contains the Agent class which is the public-facing API
// for this package.
//
// The Agent holds the configuration and all the in-memory state for
// the server.


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
  sendStatsReport,
} from './Report';

export const MIN_REPORT_INTERVAL_MS = 10 * 1000;
export const DEFAULT_REPORT_INTERVAL_MS = 60 * 1000;

export default class Agent {
  constructor(options) {
    // Public options. See README.md for descriptions.
    const {
      apiKey, debugFn, normalizeVersion, normalizeQuery,
      reportIntervalMs, printReports, disabled
    } = options || {};

    this.apiKey = apiKey || process.env.DATADOG_API_KEY;
    this.debugFn = debugFn || console.log; // eslint-disable-line no-console
    this.disabled = !!disabled;
    this.normalizeVersion = normalizeVersion || defaultNV;
    this.normalizeQuery = normalizeQuery || defaultNQ;
    this.printReports = !!printReports;

    this.reportIntervalMs = reportIntervalMs || DEFAULT_REPORT_INTERVAL_MS;
    if (this.reportIntervalMs < MIN_REPORT_INTERVAL_MS) {
      this.debugFn(
        `Optics: minimum reportInterval is ${MIN_REPORT_INTERVAL_MS}. Setting reportInterval to minimum.`,
      );
      this.reportIntervalMs = MIN_REPORT_INTERVAL_MS;
    }

    // Internal state.

    // Data we've collected so far this report period.
    this.pendingResults = {};
    // The wall clock time for the beginning of the current report period.
    this.reportStartTime = +new Date();
    // The HR clock time for the beginning of the current report
    // period. We record this so we can get an accurate duration for
    // the report even when the wall clock shifts or drifts.
    this.reportStartHrTime = process.hrtime();
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
