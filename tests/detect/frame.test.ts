import {describe,expect,it} from "vitest";
import type {Quad} from "@/lib/mockup-v3/types";
import {renderFramedPiece,type Rect} from "@/lib/mockup-v3/frame/procedural";
import {detectQuads} from "@/lib/mockup-v3/detect/quad";
import {analyseFrameLayers,suggestSourceKind} from "@/lib/mockup-v3/detect/frame";
import {projectRect} from "../helpers/fixtures";
import {addSensorNoise,cornerError,landscapeArt,lightingGradient,placeObject,plainBackground,tableBackground} from "../helpers/scenes";

const W=1200,H=900;
const art=landscapeArt(480,360,3);

function apertureGT(piece:{aperture:Rect;outer:Rect},outerQuad:Quad,imgPiece:{width:number;height:number}):Quad{
  // bilinear-in-homography: use the engine's own forward mapping via 4 known points is circular, so build from the camera model instead
  void imgPiece;void piece;
  return outerQuad;
}
void apertureGT;

describe("frame layer analysis on rendered frames",()=>{
  const styles=[
    {name:"dark moulding + wide cream mount",s:{mouldingPx:34,mouldingColour:[70,52,38] as [number,number,number],mountPx:46,mountColour:[240,236,226] as [number,number,number]}},
    {name:"thin white moulding + narrow grey mount",s:{mouldingPx:16,mouldingColour:[236,234,230] as [number,number,number],mountPx:24,mountColour:[205,208,210] as [number,number,number]}},
    {name:"black moulding, no mount",s:{mouldingPx:30,mouldingColour:[28,28,30] as [number,number,number],mountPx:0,mountColour:[255,255,255] as [number,number,number]}}
  ];
  for(const st of styles){
    it(`finds the opening: ${st.name}`,()=>{
      const piece=renderFramedPiece(art,st.s);
      const outerW=piece.image.width,outerH=piece.image.height;
      const q=projectRect({worldW:0.64,worldH:0.64*outerH/outerW,yawDeg:14,pitchDeg:5,rollDeg:1.5,distance:1.7,focalPx:1000,imgW:W,imgH:H});
      const wall:[number,number,number]=st.name.startsWith("thin white")?[150,146,138]:[214,208,198];
      const photo=addSensorNoise(lightingGradient(placeObject(plainBackground(W,H,wall,2),piece.image,q,{shadow:{offset:{x:7,y:11},sigma:7,strength:0.3}}),0.1,20),1.2);
      const best=detectQuads(photo).candidates[0];
      expect(cornerError(best.quad,q)).toBeLessThan(2);
      const fa=analyseFrameLayers(photo,best.quad);
      expect(fa.apertureQuad,"aperture found").not.toBeNull();

      // ground truth: map the rendered aperture rect through the true outer quad (fractions of the piece)
      const fx=(x:number)=>x/outerW,fy=(y:number)=>y/outerH;
      const a=piece.aperture;
      const bil=(u:number,v:number)=>{
        const [tl,tr,br,bl]=q;
        return {
          x:(1-v)*((1-u)*tl.x+u*tr.x)+v*((1-u)*bl.x+u*br.x),
          y:(1-v)*((1-u)*tl.y+u*tr.y)+v*((1-u)*bl.y+u*br.y)
        };
      };
      void bil;
      // exact projective ground truth: project aperture corners in the same camera
      const gtW=0.64,gtH=0.64*outerH/outerW;
      const sub=projectRect({worldW:gtW*(a.width/outerW),worldH:gtH*(a.height/outerH),yawDeg:14,pitchDeg:5,rollDeg:1.5,distance:1.7,focalPx:1000,imgW:W,imgH:H,
        offset:{x:0,y:0}});
      void sub;void fx;void fy;
      const gtInsets={left:a.x,top:a.y,right:outerW-a.x-a.width,bottom:outerH-a.y-a.height};
      const got=fa.insets!;
      const scale=fa.rect.width/outerW;
      console.log(`[frame] ${st.name}: insets gt(L,T,R,B)=${gtInsets.left},${gtInsets.top},${gtInsets.right},${gtInsets.bottom} got=${(got.left/scale).toFixed(1)},${(got.top/scale).toFixed(1)},${(got.right/scale).toFixed(1)},${(got.bottom/scale).toFixed(1)} conf ${fa.confidence.toFixed(2)} framed ${fa.framedScore.toFixed(2)}`);
      for(const k of ["left","top","right","bottom"] as const){
        expect(Math.abs(got[k]/scale-gtInsets[k]),`${k} inset`).toBeLessThan(2.2);
      }
      expect(fa.confidence).toBeGreaterThan(0.6);
    });
  }

  it("pale frame on a pale, shadowed wall: either accurate or explicitly flagged (never confidently wrong)",()=>{
    const piece=renderFramedPiece(art,{mouldingPx:16,mouldingColour:[236,234,230],mountPx:24,mountColour:[205,208,210]});
    const q=projectRect({worldW:0.64,worldH:0.64*piece.image.height/piece.image.width,yawDeg:14,pitchDeg:5,rollDeg:1.5,distance:1.7,focalPx:1000,imgW:W,imgH:H});
    const photo=addSensorNoise(lightingGradient(placeObject(plainBackground(W,H,[214,208,198],2),piece.image,q,{shadow:{offset:{x:7,y:11},sigma:7,strength:0.3}}),0.1,20),1.2);
    const best=detectQuads(photo).candidates[0];
    const err=cornerError(best.quad,q);
    console.log(`[frame] pale-on-pale: err ${err.toFixed(1)}px conf ${best.confidence.toFixed(2)} flags ${best.defects.map((d)=>d.code)}`);
    if(err>3){
      expect(best.confidence).toBeLessThan(0.5);
      expect(best.defects.map((d)=>d.code)).toContain("QUAD_LOW_CONFIDENCE");
    }
  });

  it("classifies a framed photo as framed and a bare print as artwork",()=>{
    const piece=renderFramedPiece(art,{mouldingPx:34,mouldingColour:[70,52,38],mountPx:46,mountColour:[240,236,226]});
    const q=projectRect({worldW:0.64,worldH:0.52,yawDeg:12,pitchDeg:5,distance:1.7,focalPx:1000,imgW:W,imgH:H});
    const photo=addSensorNoise(placeObject(plainBackground(W,H,[214,208,198],2),piece.image,q,{shadow:{offset:{x:7,y:11},sigma:7,strength:0.3}}),1.2);
    const fa=analyseFrameLayers(photo,detectQuads(photo).candidates[0].quad);
    expect(suggestSourceKind(fa).kind).toBe("framed");

    const qa=projectRect({worldW:0.5,worldH:0.375,yawDeg:10,pitchDeg:12,rollDeg:-4,distance:1.5,focalPx:1000,imgW:W,imgH:H});
    const photo2=addSensorNoise(placeObject(tableBackground(W,H),art,qa,{shadow:{offset:{x:3,y:5},sigma:3,strength:0.25}}),1.2);
    const fb=analyseFrameLayers(photo2,detectQuads(photo2).candidates[0].quad);
    const kind=suggestSourceKind(fb);
    console.log(`[frame] bare print: kind=${kind.kind} conf=${kind.confidence.toFixed(2)} layers/side=${["top","right","bottom","left"].map((s)=>fb.layers[s as "top"].length)}`);
    expect(kind.kind).toBe("artwork");
  });

  it("reports APERTURE_UNCERTAIN instead of inventing an opening when no inner edge exists",()=>{
    const flat=landscapeArt(600,450,5);
    const q=projectRect({worldW:0.5,worldH:0.375,yawDeg:0,pitchDeg:0,distance:1.5,focalPx:1000,imgW:W,imgH:H});
    const photo=placeObject(tableBackground(W,H),flat,q);
    const fa=analyseFrameLayers(photo,detectQuads(photo).candidates[0].quad);
    // a bare landscape has no straight coherent inner edge on all four sides
    if(fa.insets===null) expect(fa.defects.map((d)=>d.code)).toContain("APERTURE_UNCERTAIN");
    else expect(fa.framedScore).toBeLessThan(0.6);
  });
});
