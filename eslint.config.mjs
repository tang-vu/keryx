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
  // Flat-config plugins are scoped to the object that declares them. Patch the Next object that
  // already owns react-hooks instead of adding a detached rules-only object (which ESLint 9.39+
  // rejects as a missing plugin).
  ...base.map((entry) =>
    entry.plugins?.["react-hooks"]
      ? {
          ...entry,
          rules: {
            ...entry.rules,
            // React Compiler's set-state-in-effect over-fires on the app's intentional, benign
            // mount/route-reset patterns. Keep it visible without making those patterns fatal.
            "react-hooks/set-state-in-effect": "warn",
          },
        }
      : entry,
  ),
];

export default config;
