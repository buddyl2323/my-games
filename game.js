import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';

// Browser-hosted PeerJS room. Anyone sharing a room URL joins the same room.
// The first browser acts as authority for hits and health. It must remain online.
const $ = id => document.getElementById(id);
const canvas = $('game'), overlay = $('overlay'), status = $('status');
const params = new URLSearchParams(location.search);
const room = (params.get('room') || 'arena-' + Math.random().toString(36).slice(2,9)).replace(/[^a-zA-Z0-9-]/g,'').slice(0,40) || 'arena';
params.set('room',room); history.replaceState(null,'',location.pathname+'?'+params.toString());
$('room').textContent = 'ROOM: ' + room;
$('copy').onclick = async () => { try { await navigator.clipboard.writeText(location.href); status.textContent='Room link copied. Send it to a friend.'; } catch { status.textContent='Copy this URL: '+location.href; } };

const scene = new THREE.Scene(); scene.background = new THREE.Color(0x141d28); scene.fog = new THREE.Fog(0x141d28,55,145);
const camera = new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.05,250); camera.rotation.order='YXZ';
const renderer = new THREE.WebGLRenderer({canvas,antialias:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.setSize(innerWidth,innerHeight); renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; renderer.outputColorSpace=THREE.SRGBColorSpace; renderer.toneMapping=THREE.ACESFilmicToneMapping;
scene.add(new THREE.AmbientLight(0xb8c4d4,.55)); scene.add(new THREE.HemisphereLight(0x91abc9,0x25232a,.9));
const sun = new THREE.DirectionalLight(0xffe0bf,2.7); sun.position.set(-30,60,-20);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-85;sun.shadow.camera.right=85;sun.shadow.camera.top=85;sun.shadow.camera.bottom=-85;sun.shadow.normalBias=.025;scene.add(sun);
const mat=(color,roughness=.85,metalness=.06)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
const concrete=mat(0x65696c,.95),steel=mat(0x343a43,.58,.75),steel2=mat(0x464e55,.55,.65),black=mat(0x20252b,.8,.3);
const solids=[], blockers=[], remote=new Map(), effects=[];
function cube(w,h,d,m,x,y,z,solid=false){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;scene.add(o);blockers.push(o);if(solid)solids.push({x,z,w,d});return o;}
const ground=new THREE.Mesh(new THREE.PlaneGeometry(150,150),mat(0x34373b,.98,.02));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);blockers.push(ground);
for(let i=-70;i<=70;i+=10){cube(.035,.008,150,black,i,.005,0);cube(150,.008,.035,black,0,.006,i)}
// Eight large industrial cover objects, plus perimeter walls.
function container(x,z,rot=0){const g=new THREE.Group();const body=new THREE.Mesh(new THREE.BoxGeometry(11,4.5,4.8),steel);body.position.y=2.25;g.add(body);for(let i=-5;i<=5;i++)for(const side of [-1,1]){const rib=new THREE.Mesh(new THREE.BoxGeometry(.14,4.2,.16),steel2);rib.position.set(i*.95,2.25,side*2.43);g.add(rib)}for(const sx of [-1,1])for(const sz of [-1,1]){const post=new THREE.Mesh(new THREE.BoxGeometry(.27,4.6,.27),black);post.position.set(sx*5.4,2.3,sz*2.35);g.add(post)}g.position.set(x,0,z);g.rotation.y=rot;scene.add(g);g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}});blockers.push(g);const turn=Math.abs(Math.sin(rot))>.7;solids.push({x,z,w:turn?5.3:11.5,d:turn?11.5:5.3})}
function barrier(x,z,rot=0){const g=new THREE.Group();for(const [w,h,d,y] of [[7,.6,2.3,.3],[6.5,2.1,1.25,1.55],[6.8,.25,1.4,2.72]]){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),concrete);o.position.y=y;o.castShadow=true;o.receiveShadow=true;g.add(o)}g.position.set(x,0,z);g.rotation.y=rot;scene.add(g);blockers.push(g);const turn=Math.abs(Math.sin(rot))>.7;solids.push({x,z,w:turn?2.7:7.3,d:turn?7.3:2.7})}
container(-25,-25);container(25,-25,Math.PI/2);container(-25,25,Math.PI/2);container(25,25);
barrier(0,-16);barrier(0,16);barrier(-16,0,Math.PI/2);barrier(16,0,Math.PI/2);
cube(150,10,2,concrete,0,5,-75,true);cube(150,10,2,concrete,0,5,75,true);cube(2,10,150,concrete,-75,5,0,true);cube(2,10,150,concrete,75,5,0,true);
for(const x of [-48,48])for(const z of [-48,48]){cube(.35,11,.35,steel2,x,5.5,z,true);cube(2.5,.25,1,black,x,11,z);const lamp=new THREE.PointLight(0xffdba9,38,25);lamp.position.set(x,10.7,z);scene.add(lamp)}
const spawnPoints=[[-55,-55],[55,55],[-55,55],[55,-55],[0,-50],[0,50],[-50,0],[50,0],[-37,15],[37,-15]];
const spawn=()=>{const p=spawnPoints[Math.floor(Math.random()*spawnPoints.length)];return {x:p[0],y:0,z:p[1]}};
const me={...spawn(),yaw:0,pitch:0,vx:0,vz:0,health:100};
let myId='',host=false,ready=false,locked=false,peer=null,hostConn=null,lastFire=0,lastSync=0,shotNumber=0;
const peers=new Map(),healthById=new Map(),recentShots=new Map(),recentGrenades=new Map();const keys={};
function blocked(x,z){if(Math.abs(x)>72.5||Math.abs(z)>72.5)return true;return solids.some(b=>Math.abs(x-b.x)<b.w/2+.44&&Math.abs(z-b.z)<b.d/2+.44)}
function snapCamera(){camera.position.set(me.x,1.65,me.z);camera.rotation.set(me.pitch,me.yaw,0,'YXZ')}
snapCamera();
function makeAvatar(id){const g=new THREE.Group(),parts=[];const armor=mat(0x41474d,.7,.36),dark=mat(0x242b34,.7,.4),visor=mat(0x172733,.25,.5);function part(w,h,d,x,y,z,m){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);o.userData.playerId=id;o.castShadow=true;g.add(o);parts.push(o);return o}part(.78,.77,.4,0,1.19,0,armor);part(.43,.48,.44,0,1.83,0,armor);part(.53,.2,.48,0,2.08,0,dark);part(.34,.12,.04,0,1.86,-.24,visor);for(const a of [-1,1]){part(.3,.75,.29,a*.55,1.04,0,dark);part(.29,.65,.35,a*.2,.37,0,armor);part(.3,.17,.5,a*.2,.09,-.07,dark)}part(.15,.13,.85,.28,1.23,-.55,dark);scene.add(g);const p={id,g,parts,armor,dark,health:100,target:new THREE.Vector3(),yaw:0,flash:0};remote.set(id,p);return p}
function removeAvatar(id){const p=remote.get(id);if(!p)return;scene.remove(p.g);p.g.traverse(o=>{if(o.isMesh)o.geometry.dispose()});p.armor.dispose();p.dark.dispose();remote.delete(id);updateCount()}
function updateCount(){ $('online').textContent='PLAYERS ONLINE: '+(1+remote.size) }
function updateHealth(){ $('health').textContent='HEALTH: '+Math.max(0,Math.round(me.health));$('health').style.color=me.health<=25?'#ff6565':'white'}
function applyState(s){if(!s||!s.id||s.id===myId)return;let p=remote.get(s.id)||makeAvatar(s.id);if(!Number.isFinite(s.x)||!Number.isFinite(s.z)||!Number.isFinite(s.yaw))return;p.target.set(s.x,0,s.z);p.yaw=s.yaw;if(Number.isFinite(s.health))p.health=s.health;updateCount()}
function flash(id){const p=remote.get(id);if(p)p.flash=performance.now()+180}
function burst(point,count=12){const material=new THREE.MeshBasicMaterial({color:0x9a9d9e});for(let i=0;i<count;i++){const o=new THREE.Mesh(new THREE.BoxGeometry(.055,.055,.055),material);o.position.copy(point);scene.add(o);effects.push({o,velocity:new THREE.Vector3((Math.random()-.5)*7,Math.random()*5,(Math.random()-.5)*7),life:.43,type:'debris'})}}
function tracer(a,b){const d=b.clone().sub(a),o=new THREE.Mesh(new THREE.CylinderGeometry(.013,.013,d.length(),6),new THREE.MeshBasicMaterial({color:0xff781d}));o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());scene.add(o);effects.push({o,life:.1,type:'tracer'})}
function explosion(x,z){burst(new THREE.Vector3(x,1,z),34)}
function feed(msg){const e=document.createElement('div');e.textContent=msg;e.style.cssText='background:#0008;border-right:3px solid #f80;padding:8px;margin-bottom:5px';$('feed').appendChild(e);setTimeout(()=>e.remove(),3000)}
function showDamage(){ $('damage').style.opacity='.8';setTimeout(()=>$('damage').style.opacity='0',170) }
function hitMark(){ $('hit').style.opacity='1';setTimeout(()=>$('hit').style.opacity='0',120) }
function say(s){status.textContent=s;$('network').textContent=s}
function send(conn,msg){if(conn&&conn.open)try{conn.send(msg)}catch(e){console.warn(e)}}
function broadcast(msg,except){for(const [id,c] of peers)if(id!==except)send(c,msg)}
function localSnapshot(){return {id:myId,x:me.x,y:0,z:me.z,yaw:me.yaw,health:me.health}}
function fullRoster(){const players=[localSnapshot()];for(const [id] of peers){const s=lastStates.get(id);if(s)players.push(s)}return players}
const lastStates=new Map();
function onClientMessage(conn,m){if(!m||typeof m!=='object')return;const id=conn.peer;if(m.type==='move'){if(!Number.isFinite(m.x)||!Number.isFinite(m.z)||!Number.isFinite(m.yaw))return;const old=lastStates.get(id)||{health:100};const s={id,x:THREE.MathUtils.clamp(m.x,-72,72),y:0,z:THREE.MathUtils.clamp(m.z,-72,72),yaw:m.yaw,health:healthById.get(id)??100};lastStates.set(id,s);applyState(s);broadcast({type:'move',...s},id)}else if(m.type==='fire'){processFire(id,m)}else if(m.type==='grenade'){processGrenade(id,m)}}
function onHostMessage(m){if(!m||typeof m!=='object')return;if(m.type==='welcome'){myId=m.id;me.health=100;for(const s of m.players||[])applyState(s);ready=true;say('CONNECTED · '+room)}else if(m.type==='joined'||m.type==='move')applyState(m);else if(m.type==='left')removeAvatar(m.id);else if(m.type==='shotfx'){if(m.from&&m.to){tracer(new THREE.Vector3(...m.from),new THREE.Vector3(...m.to));if(m.impact)burst(new THREE.Vector3(...m.to),7)}}else if(m.type==='damage'){if(m.victim===myId){me.health=m.health;updateHealth();showDamage()}else{const p=remote.get(m.victim);if(p)p.health=m.health;flash(m.victim)}if(m.shooter===myId)hitMark()}else if(m.type==='respawn'){if(m.id===myId){Object.assign(me,{x:m.x,y:0,z:m.z,health:100,vx:0,vz:0});snapCamera();updateHealth()}else applyState({...m,yaw:0,health:100});explosion(m.oldX,m.oldZ);feed(m.id.slice(-5)+' respawned')}else if(m.type==='grenadefx'){grenadeVisual(m)}else if(m.type==='explosionfx'){explosionEffect(new THREE.Vector3(...m.pos))}else if(m.type==='error')say(m.message)}
function setupHost(){host=true;ready=true;myId=peer.id;healthById.set(myId,100);say('HOSTING · Share room link');peer.on('connection',conn=>{conn.on('open',()=>{peers.set(conn.peer,conn);healthById.set(conn.peer,100);const pos=spawn();const s={id:conn.peer,...pos,yaw:0,health:100};lastStates.set(conn.peer,s);send(conn,{type:'welcome',id:conn.peer,players:fullRoster().filter(p=>p.id!==conn.peer)});send(conn,{type:'respawn',id:conn.peer,...pos,oldX:pos.x,oldZ:pos.z});applyState(s);broadcast({type:'joined',...s},conn.peer);updateCount()});conn.on('data',m=>onClientMessage(conn,m));conn.on('close',()=>removeConn(conn.peer));conn.on('error',()=>removeConn(conn.peer))})}
function removeConn(id){peers.delete(id);healthById.delete(id);lastStates.delete(id);removeAvatar(id);broadcast({type:'left',id})}
function connectToHost(){host=false;hostConn=peer.connect('tactical-fps-v2-'+room,{reliable:false,serialization:'json'});hostConn.on('open',()=>say('JOINING ROOM…'));hostConn.on('data',onHostMessage);hostConn.on('close',()=>{ready=false;say('HOST DISCONNECTED · Refresh to reconnect')});hostConn.on('error',()=>say('Connection failed. Refresh to retry.'))}
function initNetwork(){if(typeof window.Peer!=='function'){say('PeerJS library could not load. Check internet access.');return}const target='tactical-fps-v2-'+room;peer=new window.Peer(target,{debug:0});peer.on('open',setupHost);peer.on('error',e=>{if(e.type==='unavailable-id'){peer.destroy();peer=new window.Peer(undefined,{debug:0});peer.on('open',()=>{myId=peer.id;connectToHost()});peer.on('error',err=>say('Network error: '+err.type))}else say('Network error: '+e.type)});peer.on('disconnected',()=>say('Signaling disconnected; active peers may still work'))}
initNetwork();
// HOST AUTHORITATIVE COMBAT: client sends an aim ray, host verifies
// intersection against host-side cover and the latest player positions.
const raycaster=new THREE.Raycaster();raycaster.far=120;
function playerHit(ray,id,state){const center=new THREE.Vector3(state.x,1.12,state.z);const box=new THREE.Box3().setFromCenterAndSize(center,new THREE.Vector3(.9,2.2,.8));const hit=ray.ray.intersectBox(box,new THREE.Vector3());return hit?hit.distanceTo(ray.ray.origin):Infinity}
const WEAPONS={
 rifle:{name:'ASSAULT RIFLE',damage:25,interval:155,range:120,color:0x343b40},
 smg:{name:'SMG',damage:15,interval:90,range:85,color:0x283038},
 marksman:{name:'MARKSMAN RIFLE',damage:50,interval:600,range:150,color:0x414a45}
};
let equipped='rifle',grenadeReadyAt=0;
function equipWeapon(name){if(!WEAPONS[name])return;equipped=name;for(const button of document.querySelectorAll('[data-weapon]'))button.classList.toggle('selected',button.dataset.weapon===name);$('equipped').textContent='WEAPON: '+WEAPONS[name].name;buildGun(name)}
for(const button of document.querySelectorAll('[data-weapon]'))button.onclick=()=>equipWeapon(button.dataset.weapon);
function damagePlayer(victim,shooter,amount){
 const health=(healthById.get(victim)??100)-amount;
 healthById.set(victim,health);
 const message={type:'damage',victim,shooter,health:Math.max(0,health)};
 broadcast(message);onHostMessage(message);
 if(health<=0){const old=victim===myId?localSnapshot():lastStates.get(victim);if(!old)return;const pos=spawn();healthById.set(victim,100);if(victim!==myId)lastStates.set(victim,{id:victim,...pos,yaw:0,health:100});const msg={type:'respawn',id:victim,...pos,oldX:old.x,oldZ:old.z};broadcast(msg);onHostMessage(msg)}
}
function processFire(shooter,m){
 const weapon=WEAPONS[m.weapon]||WEAPONS.rifle;
 const now=performance.now();if(now-(recentShots.get(shooter)||0)<weapon.interval-10)return;
 recentShots.set(shooter,now);
 const s=shooter===myId?localSnapshot():lastStates.get(shooter);if(!s)return;
 const origin=new THREE.Vector3(s.x,1.65,s.z);
 const yaw=Number.isFinite(m.yaw)?m.yaw:s.yaw,pitch=THREE.MathUtils.clamp(Number(m.pitch)||0,-1.48,1.48);
 const dir=new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)).normalize();
 raycaster.far=weapon.range;raycaster.set(origin,dir);
 let closest=weapon.range,victim=null;
 const walls=raycaster.intersectObjects(blockers,true);if(walls.length)closest=walls[0].distance;
 for(const target of [localSnapshot(),...lastStates.values()]){
  if(target.id===shooter)continue;
  const h=playerHit(raycaster,target.id,target);if(h<closest){closest=h;victim=target.id}
 }
 const end=origin.clone().addScaledVector(dir,closest);
 broadcast({type:'shotfx',from:origin.toArray(),to:end.toArray(),impact:closest<weapon.range});
 if(shooter===myId){tracer(origin,end);if(closest<weapon.range)burst(end,6)}
 if(victim)damagePlayer(victim,shooter,weapon.damage);
}
// Grenades are simulated by the host so all clients see the same explosion.
function processGrenade(shooter,m){
 const now=performance.now();if(now-(recentGrenades.get(shooter)||0)<10000)return;
 const s=shooter===myId?localSnapshot():lastStates.get(shooter);if(!s)return;
 recentGrenades.set(shooter,now);
 const yaw=Number.isFinite(m.yaw)?m.yaw:s.yaw;
 const origin=new THREE.Vector3(s.x,1.25,s.z);
 const forward=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw));
 let point=origin.clone();
 for(let i=0;i<18;i++){
  const next=point.clone().addScaledVector(forward,.65);
  if(blocked(next.x,next.z))break;
  point.copy(next);
 }
 const pos=[point.x,0.3,point.z];
 const msg={type:'grenadefx',from:[origin.x,origin.y,origin.z],pos};
 broadcast(msg);grenadeVisual(msg);
 setTimeout(()=>{
  const impact=new THREE.Vector3(...pos);
  const boom={type:'explosionfx',pos};broadcast(boom);explosionEffect(impact);
  for(const target of [localSnapshot(),...lastStates.values()]){
   if(target.id===shooter)continue;
   const distance=Math.hypot(target.x-impact.x,target.z-impact.z);
   if(distance>7.5)continue;
   const originRay=new THREE.Vector3(impact.x,1.1,impact.z);
   const targetRay=new THREE.Vector3(target.x,1.1,target.z);
   const dir=targetRay.clone().sub(originRay);const dist=dir.length();
   const ray=new THREE.Raycaster(originRay,dir.normalize(),0,Math.max(.01,dist-.5));
   if(ray.intersectObjects(blockers,true).length)continue;
   damagePlayer(target.id,shooter,Math.max(10,Math.round(75*(1-distance/9))));
  }
 },1200);
}
function grenadeVisual(m){
 const a=new THREE.Vector3(...m.from),b=new THREE.Vector3(...m.pos);
 const ball=new THREE.Mesh(new THREE.SphereGeometry(.14,12,8),new THREE.MeshStandardMaterial({color:0x344634,metalness:.5,roughness:.65}));
 ball.position.copy(a);scene.add(ball);
 const started=performance.now();
 function fly(now){const t=Math.min(1,(now-started)/1150);ball.position.lerpVectors(a,b,t);ball.position.y+=Math.sin(t*Math.PI)*2.6;ball.rotation.x+=.16;ball.rotation.z+=.1;if(t<1)requestAnimationFrame(fly);else{scene.remove(ball);ball.geometry.dispose();ball.material.dispose()}}
 requestAnimationFrame(fly);
}
function explosionEffect(pos){
 burst(pos.clone().add(new THREE.Vector3(0,1,0)),65);
 const light=new THREE.PointLight(0xff781c,85,16);light.position.copy(pos).add(new THREE.Vector3(0,1.5,0));scene.add(light);setTimeout(()=>scene.remove(light),160);
}
function throwGrenade(){
 if(!locked||!ready)return;
 const now=performance.now();if(now<grenadeReadyAt)return;
 grenadeReadyAt=now+10000;
 const m={type:'grenade',yaw:me.yaw};
 if(host)processGrenade(myId,m);else send(hostConn,m);
}

const weaponScene = new THREE.Scene();
const weaponCamera = new THREE.PerspectiveCamera(60,innerWidth/innerHeight,0.01,20);
const gun=new THREE.Group();weaponScene.add(gun);gun.position.set(.28,-.28,-.95);
weaponScene.add(new THREE.AmbientLight(0xffffff,2.5));
const weaponKey=new THREE.DirectionalLight(0xffffff,3);weaponKey.position.set(-2,4,4);weaponScene.add(weaponKey);
const barrelMat=mat(0x20262c,.36,.8),trim=mat(0x57616b,.3,.8),grip=mat(0x111518,.85,.2);
function weaponBox(w,h,d,x,y,z,m){const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);gun.add(o);return o}
let muzzle=null,recoil=0,muzzleUntil=0,bob=0;
function buildGun(name){
 while(gun.children.length){const o=gun.children[0];gun.remove(o);o.geometry?.dispose()}
 const long=name==='marksman',short=name==='smg';
 const length=long?1.12:short?.54:.84;
 weaponBox(.19,.19,length,0,0,-length*.45,barrelMat);
 weaponBox(.15,.35,.16,0,-.23,.09,grip);
 weaponBox(.17,.12,.42,0,.15,-.23,trim);
 weaponBox(.15,.18,.26,0,-.2,-.34,barrelMat);
 weaponBox(.13,.17,.38,0,.015,.23,grip);
 // Stock, optic, receiver, rail and barrel.
 weaponBox(.12,.14,.3,0,.02,.39,barrelMat);
 weaponBox(.13,.12,.18,0,.27,-.14,grip);
 weaponBox(.11,.045,.26,0,.34,-.14,trim);
 weaponBox(.17,.045,length*.65,0,.115,-length*.44,trim);
 const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,long?.62:.34,12),trim);
 barrel.rotation.x=Math.PI/2;barrel.position.z=-length-.02;gun.add(barrel);
 const front=-length-(long?.33:.19);
 muzzle=new THREE.Mesh(new THREE.ConeGeometry(.14,.3,8),new THREE.MeshBasicMaterial({color:0xffa02f}));
 muzzle.rotation.x=-Math.PI/2;muzzle.position.z=front;muzzle.visible=false;gun.add(muzzle);
}
// Keep the weapon in the camera's visible lower-right field of view.
// A small viewmodel light makes the dark rifle readable even in shadow.
const gunLight = new THREE.PointLight(0xd8e6ff, 2.8, 5);
gunLight.position.set(-0.4, 0.7, 0.1);
weaponScene.add(gunLight);
buildGun('rifle');
function fire(){
 if(!locked||!ready)return;
 const t=performance.now(),weapon=WEAPONS[equipped];if(t-lastFire<weapon.interval)return;
 lastFire=t;recoil=equipped==='marksman'?.22:.12;muzzle.visible=true;muzzleUntil=t+65;
 const m={type:'fire',yaw:me.yaw,pitch:me.pitch,weapon:equipped,n:++shotNumber};
 if(host)processFire(myId,m);else send(hostConn,m);
}
$('start').onclick=()=>canvas.requestPointerLock();canvas.onclick=()=>{if(!locked)canvas.requestPointerLock()};document.addEventListener('pointerlockchange',()=>{locked=document.pointerLockElement===canvas;overlay.style.display=locked?'none':'grid'});document.addEventListener('mousemove',e=>{if(!locked)return;me.yaw-=e.movementX*.002;me.pitch=THREE.MathUtils.clamp(me.pitch-e.movementY*.002,-Math.PI/2+.04,Math.PI/2-.04)});document.addEventListener('mousedown',e=>{if(e.button===0)fire()});document.addEventListener('keydown',e=>{if(e.code==='Digit1')equipWeapon('rifle');if(e.code==='Digit2')equipWeapon('smg');if(e.code==='Digit3')equipWeapon('marksman');if(e.code==='KeyG'&&!e.repeat)throwGrenade();keys[e.code]=true;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault()});document.addEventListener('keyup',e=>keys[e.code]=false);window.addEventListener('blur',()=>{for(const k of Object.keys(keys))keys[k]=false});
function movement(dt){let f=Number(!!keys.KeyW)-Number(!!keys.KeyS),r=Number(!!keys.KeyD)-Number(!!keys.KeyA);const length=Math.hypot(f,r)||1;f/=length;r/=length;const speed=keys.ShiftLeft?11:7;const dx=(-Math.sin(me.yaw)*f+Math.cos(me.yaw)*r)*speed,dz=(-Math.cos(me.yaw)*f-Math.sin(me.yaw)*r)*speed;const a=1-Math.exp(-12*dt);me.vx+=(dx-me.vx)*a;me.vz+=(dz-me.vz)*a;const x=me.x+me.vx*dt,z=me.z+me.vz*dt;if(!blocked(x,me.z))me.x=x;else me.vx=0;if(!blocked(me.x,z))me.z=z;else me.vz=0;snapCamera();const walking=Math.hypot(me.vx,me.vz)>.3;bob+=dt*(walking?12:3);recoil=Math.max(0,recoil-dt*.85);gun.position.y=-.28+(walking?Math.sin(bob)*.012:0)-recoil*.25;gun.rotation.x=recoil;gun.position.z=-.95+recoil*.7;if(performance.now()>muzzleUntil)muzzle.visible=false}
function animateEffects(dt){for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.life-=dt;if(e.type==='debris'){e.velocity.y-=18*dt;e.o.position.addScaledVector(e.velocity,dt);e.o.rotation.x+=dt*8;e.o.rotation.z+=dt*9}if(e.life<=0){scene.remove(e.o);e.o.geometry.dispose();if(e.o.material!==undefined&&e.type==='tracer')e.o.material.dispose();effects.splice(i,1)}}}
let previous=performance.now();function frame(now){requestAnimationFrame(frame);$('grenade').textContent=now>=grenadeReadyAt?'GRENADE: READY':'GRENADE: '+Math.ceil((grenadeReadyAt-now)/1000)+'s';const dt=Math.min((now-previous)/1000,.05);previous=now;if(locked)movement(dt);for(const p of remote.values()){p.g.position.lerp(p.target,1-Math.exp(-14*dt));const diff=Math.atan2(Math.sin(p.yaw-p.g.rotation.y),Math.cos(p.yaw-p.g.rotation.y));p.g.rotation.y+=diff*(1-Math.exp(-12*dt));const red=now<p.flash;p.armor.color.setHex(red?0xff2020:0x41474d);p.dark.color.setHex(red?0xff2020:0x242b34)}animateEffects(dt);if(ready&&now-lastSync>=1000/60){lastSync=now;const s=localSnapshot();if(host){broadcast({type:'move',...s})}else send(hostConn,{type:'move',...s})}renderer.autoClear = false;renderer.clear();renderer.render(scene,camera);renderer.clearDepth();renderer.render(weaponScene,weaponCamera)}requestAnimationFrame(frame);
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();weaponCamera.aspect=innerWidth/innerHeight;weaponCamera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
