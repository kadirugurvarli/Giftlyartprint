export type PromptSpec={
  frameDescription:string;
  /** Plain-language light description derived from the calibrated room light, e.g. "soft warm light from the upper left, shadows falling down and to the right". */
  lightDescription:string;
};

/** Edit instruction for the frame-and-shadow pass. The model is told what must NOT change as strongly as what to do. */
export function buildFrameEditPrompt(p:PromptSpec):string{
  return [
    "Edit only the masked area of this photograph of a room.",
    `Make the picture frame look like a real physical object: ${p.frameDescription}. Natural wood or material grain, crisp mitred corners, subtle bevel highlights and a believable depth where the frame meets the wall.`,
    `Add soft, physically plausible contact and drop shadows on the wall that agree with this light: ${p.lightDescription}.`,
    "Do not change the artwork inside the frame in any way: keep its content, colours, edges and proportions exactly as they are.",
    "Do not change the wall colour, furniture, plants, floor, ceiling or any other part of the room outside the mask.",
    "Do not add any object, second frame, text, signature, logo or reflection of other objects. Keep the frame size and position exactly as they are."
  ].join("\n");
}
