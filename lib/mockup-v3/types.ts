/**
 * Coordinate convention (used everywhere in mockup-v3):
 * pixel-EDGE coordinates, origin top-left, y down. Pixel (x,y) covers [x,x+1]x[y,y+1],
 * so a full image is the rectangle (0,0)-(width,height).
 */
export type Pt={x:number;y:number};

/** Quad corners in order: top-left, top-right, bottom-right, bottom-left (clockwise on screen). */
export type Quad=[Pt,Pt,Pt,Pt];

/** Row-major 3x3 matrix. */
export type Mat3=[number,number,number,number,number,number,number,number,number];

/** 8-bit sRGB, straight (non-premultiplied) alpha, RGBA interleaved. */
export type RawImage={width:number;height:number;data:Uint8ClampedArray};
