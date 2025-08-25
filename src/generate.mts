import { createClient } from "@hey-api/openapi-ts";
import type { LimitedUserConfig } from "./cli.mjs";
import {
  buildQueriesOutputPath,
  buildRequestsOutputPath,
  formatOptions,
} from "./common.mjs";
import { createSource } from "./createSource.mjs";
import { formatOutput } from "./format.mjs";
import { print } from "./print.mjs";

export async function generate(options: LimitedUserConfig, version: string) {
  const openApiOutputPath = buildRequestsOutputPath(options.output);
  const formattedOptions = formatOptions(options);

  const config: any = {
    input: formattedOptions.input,
    output: openApiOutputPath,
    services: {
      asClass: true,
    },
  };
  await createClient(config);
  const source = await createSource({
    outputPath: openApiOutputPath,
    version,
    serviceEndName: "Service", // we are hard coding this because changing the service end name was depreciated in @hey-api/openapi-ts
    pageParam: formattedOptions.pageParam,
    nextPageParam: formattedOptions.nextPageParam,
    initialPageParam: formattedOptions.initialPageParam.toString(),
  });
  await print(source, formattedOptions);
  const queriesOutputPath = buildQueriesOutputPath(options.output);
  await formatOutput(queriesOutputPath);
}
