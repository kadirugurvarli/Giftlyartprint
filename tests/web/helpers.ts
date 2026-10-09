import sharp from "sharp";
import {landscapeArt} from "../helpers/scenes";
import {printPhoto,referenceWithFramedPicture} from "../helpers/e2e";
import type {RawImage} from "@/lib/mockup-v3/types";

export const ORIGIN="https://giftly-test-preview.vercel.app";
export const GOOD_ENV={VALIDATION_UI_ENABLED:"1",VERCEL_ENV:"preview",VALIDATION_PASSWORD:"correct horse battery",VALIDATION_SESSION_SECRET:"s".repeat(40)};

export const jpegOf=(img:RawImage,exif?:Record<string,any>)=>{
  let s=sharp(Buffer.from(img.data.buffer,img.data.byteOffset,img.data.byteLength),{raw:{width:img.width,height:img.height,channels:4}}).removeAlpha();
  if(exif) s=s.withExif(exif);
  return s.jpeg({quality:90}).toBuffer();
};

export async function sampleUpload(){
  const ref=referenceWithFramedPicture();
  const print=printPhoto(landscapeArt(640,480,21));
  return {
    source:await jpegOf(print.photo),reference:await jpegOf(ref.image),
    srcDims:[print.photo.width,print.photo.height],refDims:[ref.image.width,ref.image.height]
  };
}

export async function postForm(url:string,fields:Record<string,string|Buffer>,headers:Record<string,string>={},fileName="photo.jpg"){
  const fd=new FormData();
  for(const [k,v] of Object.entries(fields)) fd.set(k,typeof v==="string"?v:new File([new Uint8Array(v)],fileName,{type:"image/jpeg"}));
  const probe=new Response(fd);
  const body=Buffer.from(await probe.arrayBuffer());
  return new Request(url,{method:"POST",body,headers:{"content-type":probe.headers.get("content-type")!,"content-length":String(body.length),origin:ORIGIN,host:new URL(ORIGIN).host,...headers}});
}
