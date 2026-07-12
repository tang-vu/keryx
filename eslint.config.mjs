/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import nextConfig from "eslint-config-next";

// eslint-config-next may export a flat-config array or a single object — normalize to an array.
const base = Array.isArray(nextConfig) ? nextConfig : [nextConfig];

const config = [
  // Generated bindings and the design-handoff artifact are not hand-authored source — skip them.
  { ignores: ["typechain-types/**", ".design-handoff/**"] },
  ...base,
  {
    rules: {
      // React Compiler's set-state-in-effect over-fires on the app's intentional, benign patterns:
      // reading a browser-only value (window.location.origin) after mount, loading once on mount,
      // and resetting UI state on a route change. Keep it a warning, not a build-blocking error
      // (project policy: don't be harsh on lint, but stay compilable).
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default config;
