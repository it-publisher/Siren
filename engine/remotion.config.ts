/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import { totalmem } from "node:os";
import { Config } from "@remotion/cli/config";

const LOW_MEMORY_BYTES = 8 * 1024 ** 3;
const LOW_MEMORY_VIDEO_CACHE_BYTES = 512 * 1024 ** 2;

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
Config.setDefaultPremountInSeconds(2);

// По умолчанию кэш видео занимает до половины памяти, а рендер запускает потоки на половину ядер. На 8 GB это слишком много: один поток медленнее, зато пик памяти ниже.
if (totalmem() <= LOW_MEMORY_BYTES) {
  Config.setConcurrency(1);
  Config.setOffthreadVideoCacheSizeInBytes(LOW_MEMORY_VIDEO_CACHE_BYTES);
}
