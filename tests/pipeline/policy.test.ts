import {describe,expect,it} from "vitest";
import type {Quad,RawImage} from "@/lib/mockup-v3/types";
import {runMockup,type MockupResult} from "@/lib/mockup-v3/pipeline";
import {renderFramedPiece} from "@/lib/mockup-v3/frame/procedural";
import {analyseGlare} from "@/lib/mockup-v3/detect/glare";
import {estimateGrain} from "@/lib/mockup-v3/composite/photo";
import {compareImages} from "@/lib/mockup-v3/qa/metrics";
import {rectifyQuad} from "@/lib/mockup-v3/geometry/warp";
import {rectQuad} from "@/lib/mockup-v3/geometry/quad";
import {rasterizePolygons} from "@/lib/mockup-v3/vision/mask";
import {DEFAULT_STYLE,emptyRoom,framedPhoto,hangPiece,makeRoom,printPhoto,referenceWithFramedPicture} from "../helpers/e2e";
import {addSensorNoise,landscapeArt} from "../helpers/scenes";
import {solidImage} from "@/lib/mockup-v3/geometry/warp";

const codes=(r:MockupResult)=>r.defects.map((d)=>d.code);
const piece=renderFramedPiece(landscapeArt(480,360,31),DEFAULT_STYLE);
const fphoto=framedPhoto(piece);
const room=emptyRoom();
const optsB={sourceFocalPx:fphoto.focalPx,referenceFocalPx:1080,pieceAspect:piece.image.width/piece.image.height,physicalWidthM:0.62,ceilingHeightM:2.6,skirtingM:0.12};

describe("rule 2: product pixels are not recoloured by default",()=>{
  const ref=referenceWithFramedPicture();
  const src=printPhoto(landscapeArt(640,480,21));
  const base={sourceFocalPx:src.focalPx,referenceFocalPx:1080,artworkAspect:640/480};

  for(const level of ["strict","environment"] as const){
    it(`A at level "${level}": product region equals the geometric resample of the source (dE ~0, no chroma shift) and nothing else is applied`,async()=>{
      const r=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:ref.image,options:{...base,realism:{level}}});
      const m=r.qa.forward!.metrics;
      expect(m.meanDeltaE).toBeLessThan(0.05);
      expect(Math.abs(m.labBias.a)).toBeLessThan(0.02);
      expect(Math.abs(m.labBias.b)).toBeLessThan(0.02);
      expect(r.qa.productPixels!.modified).toBe(false);
      expect(r.adjustments.gainMaxDeviation).toBe(0);
      expect(r.adjustments.lipShadow).toBe(0);
      expect(r.adjustments.grainSigma).toBe(0);
    });
    it(`B at level "${level}": the placed piece is the pure resample of the source (dE ~0)`,async()=>{
      const r=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:room.image,options:{...optsB,realism:{level}}});
      expect(r.qa.forward!.metrics.meanDeltaE).toBeLessThan(0.05);
      expect(Math.abs(r.qa.forward!.metrics.labBias.L)).toBeLessThan(0.05);
      expect(r.qa.productPixels!.modified).toBe(false);
    });
  }

  it("photographic level is opt-in, acts on the product, is flagged as such, and stays inside the colour budget",async()=>{
    const r=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:ref.image,options:{...base,realism:{level:"photographic"}}});
    expect(r.qa.productPixels!.modified).toBe(true);
    expect(r.adjustments.lipShadow as number).toBeGreaterThan(0.1);
    expect(r.adjustments.grainSigma as number).toBeGreaterThan(0);
    // the independent cross-check measures colour drift against the ORIGINAL photo
    const m=r.qa.crossCheck!.metrics!;
    console.log(`[photographic A] cross-check dE ${m.meanDeltaE.toFixed(2)} chroma bias a ${m.labBias.a.toFixed(2)} b ${m.labBias.b.toFixed(2)} L ${m.labBias.L.toFixed(2)}`);
    expect(Math.abs(m.labBias.a)).toBeLessThan(0.7);
    expect(Math.abs(m.labBias.b)).toBeLessThan(0.7);
    expect(r.qa.crossCheck!.pass).toBe(true);
    expect(r.qa.forward!.pass).toBe(true);
  });

  it("the default level is 'environment'",async()=>{
    const r=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:ref.image,options:base});
    expect(r.adjustments.realismLevel).toBe("environment");
  });
});

describe("rule 3: photographic realism around and (opt-in) on the product",()=>{
  it("frame depth: side face appears on angled placements only, never at strict, and never covers the front",async()=>{
    const env=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:room.image,options:{...optsB,realism:{level:"environment"}}});
    const strict=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:room.image,options:{...optsB,realism:{level:"strict"}}});
    expect(env.adjustments.depthFaces as number).toBeGreaterThanOrEqual(1);
    expect(codes(env)).toContain("DEPTH_FACES_SYNTHESISED");
    expect(strict.adjustments.depthFaces).toBe(0);
    expect(env.status).toBe("pass");
    // scene integrity still clean: depth faces are part of the declared influence region
    expect(env.qa.sceneIntegrity!.changedOutsideAllowed).toBe(0);
    // the front is identical in both (same product pixels)
    expect(env.qa.forward!.metrics.meanDeltaE).toBeLessThan(0.05);
  });

  it("frame depth is absent in a frontal room (nothing to see)",async()=>{
    const fr=makeRoom({yawDeg:0,camX:0});
    const r=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:fr.image,options:optsB});
    expect(r.adjustments.depthFaces).toBe(0);
  });

  it("texture matching measures the REFERENCE: placed flat art picks up the reference's grain and softness, not the source's",async()=>{
    const flatArt=solidImage(600,450,[228,226,219,255]); // pale paper: clearly distinct from the table
    const sp=printPhoto(flatArt);
    // a noisy reference
    const noisy=addSensorNoise(referenceWithFramedPicture().image,3.2,17);
    const clean=referenceWithFramedPicture().image;
    const run=async(refImg:RawImage)=>runMockup({mode:"artwork-in-frame",source:sp.photo,reference:refImg,options:{sourceFocalPx:1300,referenceFocalPx:1080,artworkAspect:600/450,realism:{level:"photographic"}}});
    const rn=await run(noisy),rc=await run(clean);
    const flatStd=(r:MockupResult)=>{
      const q=r.targetQuad!;
      const cx=(q[0].x+q[2].x)/2,cy=(q[0].y+q[2].y)/2;
      const x0=Math.round(cx-18),y0=Math.round(cy-10);
      let s=0,s2=0,n=0;
      for(let y=y0;y<y0+20;y++) for(let x=x0;x<x0+36;x++){
        const i=(y*r.image!.width+x)*4;
        const L=0.2126*r.image!.data[i]+0.7152*r.image!.data[i+1]+0.0722*r.image!.data[i+2];
        s+=L;s2+=L*L;n++;
      }
      return Math.sqrt(Math.max(0,s2/n-(s/n)**2));
    };
    const a=flatStd(rn),b=flatStd(rc);
    console.log(`[texture] placed-art luma std: noisy reference ${a.toFixed(2)} (measured grain ${(rn.adjustments.grainSigma as number).toFixed(2)}) vs clean reference ${b.toFixed(2)} (measured ${(rc.adjustments.grainSigma as number).toFixed(2)})`);
    expect(rn.adjustments.grainSigma as number).toBeGreaterThan(2*(rc.adjustments.grainSigma as number));
    expect(a).toBeGreaterThan(b+1.0);
  });

  it("glass sheen can only lighten and is bounded; grain/softness never shift mean colour",async()=>{
    const ref=referenceWithFramedPicture();
    const src=printPhoto(landscapeArt(640,480,21));
    const env=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:ref.image,options:{sourceFocalPx:1300,referenceFocalPx:1080,artworkAspect:640/480,realism:{level:"environment"}}});
    const pho=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:ref.image,options:{sourceFocalPx:1300,referenceFocalPx:1080,artworkAspect:640/480,realism:{level:"photographic",lipShadowStrength:0,gainStrength:0,glassSheen:0.04}}});
    const q=ref.apertureQuad;
    const poly=rasterizePolygons([q.map((p)=>({x:p.x+8,y:p.y+8}))],ref.image.width,ref.image.height,1);
    void poly;
    const A=rectifyQuad(env.image!,env.targetQuad!,400,300),B=rectifyQuad(pho.image!,pho.targetQuad!,400,300);
    const m=compareImages(A,B,{margin:12});
    console.log(`[sheen+texture] vs environment: dE ${m.meanDeltaE.toFixed(2)} L bias ${m.labBias.L.toFixed(2)} a ${m.labBias.a.toFixed(2)} b ${m.labBias.b.toFixed(2)}`);
    // a veiling highlight desaturates a little (physically right); it must stay small
    expect(Math.abs(m.labBias.a)).toBeLessThan(0.7);
    expect(Math.abs(m.labBias.b)).toBeLessThan(0.7);
    expect(m.labBias.L).toBeGreaterThan(-0.3);   // sheen lightens, grain is zero-mean
    expect(m.meanDeltaE).toBeLessThan(3);
  });

  it("source glare is detected and reported (never silently carried into the mockup)",async()=>{
    const glazed=renderFramedPiece(landscapeArt(480,360,31),DEFAULT_STYLE);
    // paint a blown-out reflection of a window across the glass
    for(let y=120;y<230;y++) for(let x=170;x<330;x++){
      const o=(y*glazed.image.width+x)*4;
      const k=Math.max(0,1-Math.abs((x-250)/80));
      for(let c=0;c<3;c++) glazed.image.data[o+c]=Math.min(255,glazed.image.data[o+c]*(1-k)+255*k);
    }
    expect(analyseGlare(glazed.image,glazed.aperture).defects.map((d)=>d.code)).toContain("SOURCE_GLARE_DETECTED");
    expect(analyseGlare(piece.image,piece.aperture).defects.length).toBe(0);
    const g=framedPhoto(glazed);
    const r=await runMockup({mode:"framed-on-wall",source:g.photo,reference:room.image,options:{...optsB,sourceFocalPx:g.focalPx}});
    expect(codes(r)).toContain("SOURCE_GLARE_DETECTED");
    expect(r.status).toBe("review");
  });
});

describe("rule 4: the reference decides placement",()=>{
  const refHung=referenceWithFramedPicture();
  const inQuad=(q:Quad,p:{x:number;y:number})=>{
    const c=rasterizePolygons([q.map((v)=>({x:v.x,y:v.y}))],2000,2000,1);
    return c[Math.round(p.y)*2000+Math.round(p.x)]>200;
  };

  it("a framed picture already in the reference is replaced IN PLACE (centred on it, fully covering it)",async()=>{
    const r=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:refHung.image,options:{sourceFocalPx:fphoto.focalPx,referenceFocalPx:1080,pieceAspect:piece.image.width/piece.image.height}});
    expect(r.adjustments.placement).toBe("replace-existing");
    expect(r.adjustments.replacedCovered as number).toBeGreaterThanOrEqual(0.995);
    for(const c of refHung.outerQuad) expect(inQuad(r.targetQuad!,c)).toBe(true);
    const cx=(refHung.outerQuad[0].x+refHung.outerQuad[2].x)/2,cy=(refHung.outerQuad[0].y+refHung.outerQuad[2].y)/2;
    const tx=(r.targetQuad![0].x+r.targetQuad![2].x)/2,ty=(r.targetQuad![0].y+r.targetQuad![2].y)/2;
    expect(Math.hypot(cx-tx,cy-ty)).toBeLessThan(2.5);
    expect(r.qa.sceneIntegrity!.changedOutsideAllowed).toBe(0);
    expect(r.qa.forward!.pass).toBe(true);
    // light comes from the reference's own shadows, not a default
    expect(r.adjustments.lightSource).toBe("measured");
    expect(["pass","review"]).toContain(r.status);
  });

  it("the old picture is really gone: its artwork area is replaced (frames here share a colour, so test the art area)",async()=>{
    const r=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:refHung.image,options:{sourceFocalPx:fphoto.focalPx,referenceFocalPx:1080,pieceAspect:piece.image.width/piece.image.height}});
    const cov=rasterizePolygons([refHung.apertureQuad.map((p)=>({x:p.x,y:p.y}))],refHung.image.width,refHung.image.height,1);
    let tot=0,ch=0;
    for(let i=0;i<cov.length;i++) if(cov[i]>250){tot++;if(Math.abs(r.image!.data[i*4]-refHung.image.data[i*4])+Math.abs(r.image!.data[i*4+1]-refHung.image.data[i*4+1])>10) ch++;}
    expect(ch/tot).toBeGreaterThan(0.9);
  });

  it("a differently-proportioned piece still covers the old frame, and a much larger result is flagged",async()=>{
    const tall=renderFramedPiece(landscapeArt(400,500,41),DEFAULT_STYLE);
    const tp=framedPhoto(tall);
    const r=await runMockup({mode:"framed-on-wall",source:tp.photo,reference:refHung.image,options:{sourceFocalPx:tp.focalPx,referenceFocalPx:1080,pieceAspect:tall.image.width/tall.image.height}});
    expect(r.adjustments.replacedCovered as number).toBeGreaterThanOrEqual(0.995);
    expect(codes(r)).toContain("REPLACEMENT_SIZE_MISMATCH");
    expect(r.status).toBe("review");
    for(const c of refHung.outerQuad) expect(inQuad(r.targetQuad!,c)).toBe(true);
  });

  it("an empty-wall reference still gets free-wall placement; 'free-wall' can be forced; 'replace-existing' fails clearly when there is nothing to replace",async()=>{
    const a=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:room.image,options:optsB});
    expect(a.adjustments.placement).toBe("free-wall");
    const forced=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:refHung.image,options:{...optsB,placement:"free-wall"}});
    expect(forced.adjustments.placement).toBe("free-wall");
    const none=await runMockup({mode:"framed-on-wall",source:fphoto.photo,reference:room.image,options:{...optsB,placement:"replace-existing"}});
    expect(none.status).toBe("fail");
    expect(codes(none)).toContain("QUAD_NOT_FOUND");
  });
});

describe("rule 1/6 housekeeping",()=>{
  it("no workflow emits text, logos or social crops: outputs keep the reference's size",async()=>{
    const ref=referenceWithFramedPicture();
    const src=printPhoto(landscapeArt(640,480,21));
    const a=await runMockup({mode:"artwork-in-frame",source:src.photo,reference:ref.image,options:{sourceFocalPx:1300,referenceFocalPx:1080,artworkAspect:640/480}});
    expect({w:a.image!.width,h:a.image!.height}).toEqual({w:ref.image.width,h:ref.image.height});
    expect(a.qa.sceneIntegrity!.changedOutsideAllowed).toBe(0);
  });
});
void hangPiece;void estimateGrain;
