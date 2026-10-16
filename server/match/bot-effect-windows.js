// Offline candidate guard. Real callbacks and target priority are not replaced by this geometric approximation.
// [ASSUMED] Reserve contact and the last three public path tiles are distinct tactical windows.
const sensitive=u=>{const d=u.descriptor||{};return!!(d.heal||d.healRatio||d.normalControl||d.activeControl||d.hasOpaqueCallbacks);};
const covers=(u,rt,key,active=false)=>!u.heal&&(!rt.fly||(active?u.activeAir:u.basicAir))&&(active?u.skillCover:u.cover).has(key);
export function effectWindows(units,model,uid){
 const u=units.find(u=>u.uid===uid);if(!u)return null;
 const routes=model.routes.filter(rt=>rt.n>0).map(rt=>{
  const blockers=rt.fly?[]:units.filter(t=>t.block>0&&rt.tiles.includes(t.key)).sort((a,b)=>rt.tiles.indexOf(a.key)-rt.tiles.indexOf(b.key));
  const contact=blockers.slice(0,2).map(t=>({uid:t.uid,key:rt.tiles[Math.max(0,rt.tiles.indexOf(t.key)-1)]}));
  const late=rt.tiles.slice(-3),basicLate=late.filter(k=>covers(u,rt,k)).length,activeLate=late.filter(k=>covers(u,rt,k,true)).length;
  return{basicLate,activeLate,contact:contact.map(t=>({uid:t.uid,basic:covers(u,rt,t.key),active:covers(u,rt,t.key,true)}))};
 });
 const allies=u.descriptor?.heal||u.descriptor?.healRatio||u.descriptor?.protege
  ?units.filter(t=>t.uid!==uid&&t.block>0&&model.ground.has(t.key)&&u.cover.has(t.key)).map(t=>t.uid):[];
 return{uid,sensitive:sensitive(u),routes,allies};
}
/** A per-operator loss cannot be paid for by a different unit's extra raw DPS elsewhere. No fixed facing is preferred. */
export function preserveEffectWindows(before,after,model,{uid=null}={}){
 const watch=uid==null?before.filter(sensitive):before.filter(u=>u.uid===uid&&sensitive(u));
 for(const u of watch){
  const a=effectWindows(before,model,u.uid),b=effectWindows(after,model,u.uid);if(!b)return{accepted:false,reason:'missing-operator',uid:u.uid};
  for(let i=0;i<a.routes.length;i++){
   const x=a.routes[i],y=b.routes[i];
   if(y.basicLate<x.basicLate||y.activeLate<x.activeLate)return{accepted:false,reason:'late-window-loss',uid:u.uid,route:i,before:x,after:y};
   for(const t of x.contact){const q=y.contact.find(q=>q.uid===t.uid);
    if(t.basic&&!q?.basic||t.active&&!q?.active)return{accepted:false,reason:'contact-window-loss',uid:u.uid,route:i,target:t.uid};}
  }
  if(a.allies.some(id=>!b.allies.includes(id)))return{accepted:false,reason:'ally-support-loss',uid:u.uid};
 }
 return{accepted:true,reason:'windows-retained'};
}
