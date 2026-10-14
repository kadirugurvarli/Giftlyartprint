import {createHash} from "node:crypto";
import type {RawImage} from "./types";
import type {MockupResult} from "./pipeline";

/**
 * Approval gate between the CLEAN mockup and anything marketing-related (headlines, logos, CTAs,
 * social crops). Nothing in lib/mockup-v3 draws text or branding; any future marketing step must
 * call `requireApprovedMockup` with the exact pixels a person approved.
 */
export type MockupApproval={
  /** SHA-256 of the approved pixels (+ dimensions). Any later change invalidates the approval. */
  fingerprint:string;
  approvedBy:string;
  approvedAt:string;
  note?:string;
};

export class ApprovalError extends Error{
  constructor(message:string){super(message);this.name="ApprovalError";}
}

export function fingerprintImage(img:RawImage):string{
  const h=createHash("sha256");
  h.update(`${img.width}x${img.height}:`);
  h.update(Buffer.from(img.data.buffer,img.data.byteOffset,img.data.byteLength));
  return h.digest("hex");
}

/** A person approves a specific clean mockup. Failed results cannot be approved. */
export function approveMockup(result:MockupResult,approvedBy:string,note?:string,now:Date=new Date()):MockupApproval{
  if(!approvedBy.trim()) throw new ApprovalError("An approver name is required.");
  if(!result.image) throw new ApprovalError("There is no mockup image to approve.");
  if(result.status==="fail") throw new ApprovalError("A mockup that failed its quality checks cannot be approved.");
  return {fingerprint:fingerprintImage(result.image),approvedBy:approvedBy.trim(),approvedAt:now.toISOString(),note};
}

/** Throws unless `image` is exactly the approved mockup. The only way into marketing/social code. */
export function requireApprovedMockup(image:RawImage,approval:MockupApproval|undefined|null):void{
  if(!approval) throw new ApprovalError("The clean mockup has not been approved.");
  if(fingerprintImage(image)!==approval.fingerprint) throw new ApprovalError("The image differs from the approved mockup; approve it again.");
}
