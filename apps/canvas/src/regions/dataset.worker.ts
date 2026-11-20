/** No Page, owner or renderer crosses this boundary. */
import { datasetOutcome } from "./datasetRows.ts";
import type { DatasetRequest } from "./datasetModel.ts";

self.onmessage = ({ data }: MessageEvent<DatasetRequest>) => {
  self.postMessage(datasetOutcome(data));
};
