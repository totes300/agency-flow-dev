import "@testing-library/jest-dom/vitest";

// Pin a DST-observing timezone so "DST spring-forward / fall-back" assertions
// in date helpers actually exercise a real transition (CI default is UTC,
// which has no DST). The workday tests author chose US DST boundaries
// (Mar 8 spring-forward, Nov 1 fall-back) — match that.
process.env.TZ = "America/New_York";
