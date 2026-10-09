import {runArtworkInFrame} from "./artwork-in-frame";
import {runFramedOnWall} from "./framed-on-wall";
import type {MockupJobInput,MockupResult} from "./types";

export type {MockupJobInput,MockupResult,MockupOptions,ManualInputs,MockupMode,MockupStatus,RealismLevel,RealismOptions} from "./types";

/** Run a mockup job. The returned image (if any) is clean: no text, no branding, no social crop. */
export async function runMockup(input:MockupJobInput):Promise<MockupResult>{
  return input.mode==="artwork-in-frame"?runArtworkInFrame(input):runFramedOnWall(input);
}
