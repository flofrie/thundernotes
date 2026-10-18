/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Test-only validator: register every schema locally, so relative $refs never need the network.
import { readFileSync, readdirSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

const directory = new URL("../docs/schemas/", import.meta.url);
const ajv = new Ajv2020({ allErrors: true, strict: true });
const ids = new Map<string, string>();
for (const name of readdirSync(directory).filter((name) => name.endsWith(".schema.json"))) {
  const schema = JSON.parse(readFileSync(new URL(name, directory), "utf8"));
  ajv.addSchema(schema);
  ids.set(name, schema.$id);
}

export function schemaValidator(name: string) {
  const id = ids.get(name);
  if (!id) throw new Error(`Unknown schema: ${name}`);
  return ajv.getSchema(id)!;
}

export function schemaExample(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`examples/${name}`, directory), "utf8"));
}
