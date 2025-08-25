import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@hey-api/openapi-ts";
export const outputPath = (prefix: string) =>
  path.join("tests", `${prefix}-outputs`);

export const generateTSClients = async (prefix: string, inputFile?: string) => {
  const config = {
    input: path.join(__dirname, "inputs", inputFile ?? "petstore.yaml"),
    output: {
      path: outputPath(prefix),
    },
    plugins: [
      '@hey-api/typescript',
      {
        name: '@hey-api/sdk',
        asClass: true, // Try to generate classes
      },
      '@hey-api/schemas'
    ],
  };
  await createClient(config as any);
};

export const cleanOutputs = async (prefix: string) => {
  const output = `${prefix}-outputs`;
  if (existsSync(path.join(__dirname, output))) {
    await rm(path.join(__dirname, output), { recursive: true });
  }
};
