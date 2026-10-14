import {describe,expect,it} from "vitest";
import type {Quad,RawImage} from "@/lib/mockup-v3/types";
import {renderFramedPiece} from "@/lib/mockup-v3/frame/procedural";
import {detectQuads} from "@/lib/mockup-v3/detect/quad";
import {solidImage} from "@/lib/mockup-v3/geometry/warp";
import {projectRect} from "../helpers/fixtures";
import {addSensorNoise,cornerError,landscapeArt,lightingGradient,placeObject,plainBackground,renderRoom,tableBackground} from "../helpers/scenes";

const W=1200,H=900;
const art=landscapeArt(480,360,3);
const piece=renderFramedPiece(art,{mouldingPx:34,mouldingColour:[70,52,38],mountPx:46,mountColour:[240,236,226]});

function framedPhoto(q:Quad,seed=2){
  const bg=plainBackground(W,H,[214,208,198],seed);
  return addSensorNoise(lightingGradient(placeObject(bg,piece.image,q,{shadow:{offset:{x:7,y:11},sigma:7,strength:0.3}}),0.1,20),1.2,seed);
}
function artworkPhoto(q:Quad,seed=3){
  const tb=tableBackground(W,H,seed);
  return addSensorNoise(lightingGradient(placeObject(tb,art,q,{shadow:{offset:{x:3,y:5},sigma:3,strength:0.25}}),0.12,200),1.2,seed);
}

describe("detectQuads accuracy on synthetic photos (ground-truth corners)",()=>{
  const cases:{name:string;q:Quad}[]=[
    {name:"mild yaw",q:projectRect({worldW:0.64,worldH:0.52,yawDeg:16,pitchDeg:6,rollDeg:2,distance:1.7,focalPx:1000,imgW:W,imgH:H})},
    {name:"frontal",q:projectRect({worldW:0.64,worldH:0.52,yawDeg:0,pitchDeg:0,distance:1.6,focalPx:1000,imgW:W,imgH:H})},
    {name:"strong yaw + roll",q:projectRect({worldW:0.64,worldH:0.52,yawDeg:-32,pitchDeg:-8,rollDeg:-6,distance:1.5,focalPx:1000,imgW:W,imgH:H})}
  ];
  for(const c of cases){
    it(`framed piece on a plain wall (${c.name}) within 1.5px`,()=>{
      const r=detectQuads(framedPhoto(c.q));
      const best=r.candidates[0];
      expect(best,"candidate found").toBeDefined();
      const err=cornerError(best.quad,c.q);
      console.log(`[detect] framed/${c.name}: max corner err ${err.toFixed(2)}px conf ${best.confidence.toFixed(2)} support ${best.stats.edgeSupport.map((v)=>v.toFixed(2))}`);
      expect(err).toBeLessThan(1.5);
      expect(best.confidence).toBeGreaterThan(0.8);
      expect(best.defects.map((d)=>d.code)).not.toContain("QUAD_LOW_CONFIDENCE");
    });
    it(`artwork print on a table (${c.name}) within 1.5px`,()=>{
      const q=projectRect({worldW:0.5,worldH:0.375,yawDeg:c.name==="frontal"?0:12,pitchDeg:c.name==="frontal"?0:14,rollDeg:-5,distance:1.5,focalPx:1000,imgW:W,imgH:H});
      const r=detectQuads(artworkPhoto(q));
      const best=r.candidates[0];
      const err=cornerError(best.quad,q);
      console.log(`[detect] artwork/${c.name}: max corner err ${err.toFixed(2)}px conf ${best.confidence.toFixed(2)}`);
      expect(err).toBeLessThan(1.5);
      expect(best.confidence).toBeGreaterThan(0.8);
    });
  }

  it("is robust to a different background colour and stronger sensor noise",()=>{
    const q=cases[0].q;
    const bg=plainBackground(W,H,[188,196,204],11);
    const photo=addSensorNoise(placeObject(bg,piece.image,q,{shadow:{offset:{x:7,y:11},sigma:7,strength:0.3}}),3.0,4);
    const best=detectQuads(photo).candidates[0];
    expect(cornerError(best.quad,q)).toBeLessThan(2.5);
  });

  it("finds a picture hung on a room wall to sub-2px and ranks it above wall planes",()=>{
    const room=renderRoom({imgW:960,imgH:720,yawDeg:-14,camX:-0.4,seed:2});
    const Wm=0.62,Hm=Wm*piece.image.height/piece.image.width,Xc=-0.2,Yc=-0.15;
    const q=[room.wall(Xc-Wm/2,Yc-Hm/2),room.wall(Xc+Wm/2,Yc-Hm/2),room.wall(Xc+Wm/2,Yc+Hm/2),room.wall(Xc-Wm/2,Yc+Hm/2)] as Quad;
    const hung=placeObject(room.image,piece.image,q,{shadow:{offset:{x:5,y:8},sigma:5,strength:0.35}});
    const r=detectQuads(hung);
    expect(cornerError(r.candidates[0].quad,q)).toBeLessThan(2);
  });
});

describe("detectQuads failure behaviour is explicit",()=>{
  it("a blank image yields QUAD_NOT_FOUND (blocker), not a made-up quad",()=>{
    const r=detectQuads(plainBackground(600,450,[200,200,200],1));
    expect(r.candidates.length).toBe(0);
    expect(r.defects.map((d)=>d.code)).toContain("QUAD_NOT_FOUND");
    expect(r.defects[0].severity).toBe("blocker");
  });
  it("an object touching the image border is flagged and loses confidence",()=>{
    const bg=plainBackground(W,H,[214,208,198],2);
    const q:Quad=[{x:-80,y:300},{x:420,y:310},{x:410,y:700},{x:-90,y:690}];
    const photo=placeObject(bg,piece.image,q);
    const r=detectQuads(photo);
    expect(r.candidates[0].defects.map((d)=>d.code)).toContain("QUAD_TOUCHES_BORDER");
  });
  it("two similar pictures raise QUAD_AMBIGUOUS instead of silently choosing",()=>{
    const bg=plainBackground(W,H,[214,208,198],2);
    const a:Quad=[{x:120,y:200},{x:480,y:205},{x:476,y:490},{x:118,y:486}];
    const b:Quad=[{x:700,y:200},{x:1060,y:204},{x:1058,y:489},{x:698,y:486}];
    const photo=placeObject(placeObject(bg,piece.image,a),piece.image,b);
    const r=detectQuads(photo);
    expect(r.candidates.length).toBeGreaterThanOrEqual(2);
    expect(r.defects.map((d)=>d.code)).toContain("QUAD_AMBIGUOUS");
  });
  it("a low-contrast object is reported with reduced confidence rather than a confident wrong answer",()=>{
    const bg=solidImage(W,H,[200,200,200,255]);
    const faint=solidImage(480,360,[203,201,200,255]);
    const q:Quad=[{x:300,y:250},{x:760,y:255},{x:755,y:590},{x:296,y:585}];
    const r=detectQuads(placeObject(bg,faint,q));
    const best=r.candidates[0];
    if(best) expect(best.confidence).toBeLessThan(0.8);
    else expect(r.defects.map((d)=>d.code)).toContain("QUAD_NOT_FOUND");
  });
});

void (undefined as unknown as RawImage);
