import type {SpendGuard} from "./spend";

/**
 * Brief and request builder for the ONE AI-generated room image (OpenAI `POST /v1/images/generations`).
 * Request schema verified against OpenAI's published OpenAPI spec 2.3.0 (`CreateImageRequest`): `model`, `prompt` (<= 32000),
 * `n`, `quality` (low|medium|high|auto), `size` (gpt-image-2: any WxH, both divisible by 16, aspect within 1:3..3:1, up to
 * 3840x2160, above 2560x1440 experimental), `output_format` png|jpeg|webp; the response is always base64 (`data[0].b64_json`);
 * `response_format` is unsupported for GPT image models and is never sent. Price per image is NOT in the spec.
 * Nothing here calls the network by itself.
 */
export const ROOM_SIZE="2560x1440"; // largest non-experimental size for gpt-image-2 per the spec text

export const ROOM_BRIEF={
  scene:"a cosy, lived-in English living room (UK terraced or semi-detached house), photographed straight-on from about chest height",
  must:[
    "one large, plain, flat, matt painted wall facing the camera, at least two thirds of the picture width, completely EMPTY: no frames, pictures, posters, mirrors, clocks, shelves, switches, radiators or text on it",
    "soft natural daylight from a window out of frame on the left, gentle shadows, warm neutral colour balance",
    "a comfortable sofa in front of the wall with cushions and a throw, leaving at least 60 cm of bare wall above the back of the sofa",
    "healthy houseplants (a floor plant and a small plant on a side table) placed to the side so they never overlap the central wall area",
    "a few books and a mug on a side table or low shelf at the side, not in front of the wall centre",
    "a visible door frame or window frame with straight vertical edges on the same wall plane, fully in view (used as a calibration reference)",
    "wooden floor, skirting board running along the wall base, a rug"
  ],
  avoid:[
    "any artwork, frame, photograph, mirror or poster anywhere in the image",
    "any readable text, logo, signature or watermark",
    "people, pets, hands","fisheye or wide-angle distortion, strong perspective, tilted horizon",
    "a very dark or high-contrast image, blown-out windows, heavy vignette",
    "furniture or plants in front of the central wall area"
  ]
};

export function buildRoomPrompt():string{
  return [
    `Photorealistic interior photograph of ${ROOM_BRIEF.scene}.`,
    "The image must contain:",...ROOM_BRIEF.must.map(s=>`- ${s}`),
    "Style: natural, unstaged, magazine-quality real-estate photography, sharp focus across the whole image, realistic materials and textures, true-to-life colours.",
    "Camera: eye-level, level horizon, vertical lines vertical, modest field of view (about 35 mm equivalent).",
    "Strictly avoid:",...ROOM_BRIEF.avoid.map(s=>`- ${s}`)
  ].join("\n");
}

export type RoomGenRequest={url:string;body:{model:string;prompt:string;n:1;quality:"low"|"medium"|"high";size:string;output_format:"png"};summary:{model:string;size:string;quality:string;promptChars:number}};

export function buildRoomGenRequest(o:{model?:string;quality?:"low"|"medium"|"high";size?:string}={}):RoomGenRequest{
  const model=o.model ?? "gpt-image-2";
  if(model!=="gpt-image-2") throw new Error("MODEL_NOT_VERIFIED");
  const size=o.size ?? ROOM_SIZE;
  const m=/^(\d+)x(\d+)$/.exec(size);
  if(!m) throw new Error("SIZE_INVALID");
  const w=+m[1],h=+m[2];
  if(w%16||h%16) throw new Error("SIZE_NOT_DIVISIBLE_BY_16");
  if(Math.max(w/h,h/w)>3) throw new Error("SIZE_ASPECT_OUT_OF_RANGE");
  if(Math.max(w,h)>3840||w*h>3840*2160) throw new Error("SIZE_ABOVE_MAXIMUM");
  const prompt=buildRoomPrompt();
  return {url:"https://api.openai.com/v1/images/generations",body:{model,prompt,n:1,quality:o.quality ?? "high",size,output_format:"png"},summary:{model,size,quality:o.quality ?? "high",promptChars:prompt.length}};
}

/** The one paid room generation. Throws before any network use unless the guard allows it; key read from the environment only. */
export async function generateRoom(req:RoomGenRequest,o:{guard:SpendGuard;apiKey?:()=>string|undefined;fetchImpl?:typeof fetch;timeoutMs?:number}):Promise<Buffer>{
  o.guard.reserve();
  const key=(o.apiKey ?? (()=>process.env.OPENAI_API_KEY))();
  if(!key) throw new Error("OPENAI_API_KEY_MISSING");
  const res=await (o.fetchImpl ?? fetch)(req.url,{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(req.body),signal:AbortSignal.timeout(o.timeoutMs ?? 300000)});
  const data=await res.json().catch(()=>null) as {data?:{b64_json?:string}[];error?:{message?:string}}|null;
  if(!res.ok||!data?.data?.[0]?.b64_json) throw new Error(`OPENAI_GENERATION_FAILED: HTTP ${res.status}${data?.error?.message?" "+data.error.message.slice(0,200):""}`);
  return Buffer.from(data.data[0].b64_json,"base64");
}
