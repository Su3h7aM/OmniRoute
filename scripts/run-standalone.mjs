#!/usr/bin/env bun

import { bootstrapEnv } from "./bootstrap-env.mjs";
import {
  resolveRuntimePorts,
  spawnWithForwardedSignals,
  withRuntimePortEnv,
} from "./runtime-env.mjs";

const env = bootstrapEnv();
const runtimePorts = resolveRuntimePorts(env);

spawnWithForwardedSignals(process.execPath, ["server.js"], {
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
  env: withRuntimePortEnv(env, runtimePorts),
});
