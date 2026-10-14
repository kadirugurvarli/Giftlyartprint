/** sRGB <-> linear light helpers shared by the compositing modules. */
export const SRGB_TO_LINEAR=(()=>{
  const t=new Float32Array(256);
  for(let i=0;i<256;i++){
    const c=i/255;
    t[i]=c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);
  }
  return t;
})();

export function linearToSrgb8(v:number){
  if(!(v>0)) return 0;
  if(v>=1) return 255;
  const c=v<=0.0031308?v*12.92:1.055*Math.pow(v,1/2.4)-0.055;
  return Math.round(c*255);
}

export const luma8=(r:number,g:number,b:number)=>0.2126*r+0.7152*g+0.0722*b;
