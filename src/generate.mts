import { type UserConfig, createClient } from "@hey-api/openapi-ts";
import type { LimitedUserConfig } from "./cli.mjs";
import {
  buildQueriesOutputPath,
  buildRequestsOutputPath,
  formatOptions,
} from "./common.mjs";
import { createSource } from "./createSource.mjs";
import { formatOutput, processOutput } from "./format.mjs";
import { print } from "./print.mjs";

export async function generate(options: LimitedUserConfig, version: string) {
  const openApiOutputPath = buildRequestsOutputPath(options.output);
  const formattedOptions = formatOptions(options);

  const plugins: any[] = [
    '@hey-api/typescript',
    {
      name: '@hey-api/sdk',
      asClass: false,
      operationId: !formattedOptions.noOperationId,
    },
  ];

  // Add client plugin if specified
  if (formattedOptions.client) {
    plugins.push({
      name: formattedOptions.client,
      output: 'client',
    });
  }

  // Add schemas plugin if not disabled
  if (!formattedOptions.noSchemas) {
    plugins.push({
      name: '@hey-api/schemas',
      type: formattedOptions.schemaType || 'json',
    });
  }

  const config: UserConfig = {
    input: formattedOptions.input,
    output: {
      path: openApiOutputPath,
      format: formattedOptions.format || false,
      lint: formattedOptions.lint || false,
    },
    plugins,
    dryRun: false,
  };
  await createClient(config);
  const source = await createSource({
    outputPath: openApiOutputPath,
    client: formattedOptions.client || "@hey-api/client-fetch",
    version,
    pageParam: formattedOptions.pageParam,
    nextPageParam: formattedOptions.nextPageParam,
    initialPageParam: formattedOptions.initialPageParam.toString(),
  });
  await print(source, formattedOptions);
  const queriesOutputPath = buildQueriesOutputPath(options.output);
  await formatOutput(queriesOutputPath);
  await processOutput({
    output: queriesOutputPath,
    format: formattedOptions.format,
    lint: formattedOptions.lint,
  });
}
