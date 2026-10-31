/* WHISPER STATION: self-contained canvas raycasting horror game.
   Offline solo: no network or external libraries required.
   Online co-op: PeerJS loaded on demand from CDN for WebRTC signaling. */
(()=>{'use strict';
const canvas=document.getElementById('game'),ctx=canvas.getContext('2d',{alpha:false});
const ui={overlay:document.getElementById('overlay'),message:document.getElementById('message'),prompt:document.getElementById('prompt'),objective:document.getElementById('objective'),fuses:document.getElementById('fuses'),battery:document.getElementById('battery'),people:document.getElementById('people'),room:document.getElementById('room')};
const MAP=[
'########################',
'#......#...............#',
'#.##.#.#.#####.######..#',
'#....#...#...#......#..#',
'####.#####.#.######.#..#',
'#..........#........#..#',
'#.##########.########..#',
'#....#...........#......#',
'#.##.#.#########.#.###..#',
'#....#.....#.....#...#..#',
'#.########.#.#######.#..#',
'#..........#.........#..#',
'#.##########.#######.#..#',
'#...........#.......#...#',
'#.#########.#.#####.###.#',
'#.....#.....#.....#.....#',
'#####.#.#########.#.###.#',
'#.....#...........#.....#',
'#.####################..#',
'#......................#',
'########################'];
const H=MAP.length,W=24;const wall=(x,y)=>{const i=Math.floor(y),j=Math.floor(x);return i<0||i>=H||j<0||j>=W||MAP[i][j]==='#'||MAP[i][j]===undefined};
let mode='solo',running=false,won=false,dead=false,locked=false,last=0,frame=0,flashlight=true,fear=0,scare=0,ambient=0,peer=null,hostConn=null,isHost=false,hostID='',roomCode='',sendAcc=0,connectionState='offline';
const keys={},others=new Map(),connections=new Map();let player={x:2.5,y:1.5,a:0,fuses:0};
const items=[{x:21.5,y:1.5,got:false},{x:2.5,y:13.5,got:false},{x:20.5,y:17.5,got:false}];
const exit={x:21.5,y:19.5};let ghost={x:13.5,y:7.5,phase:0,visible:false};
const spawn={x:2.5,y:1.5};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),dist=(a,b,c,d)=>Math.hypot(a-c,b-d);
function resize(){const scale=Math.min(1,1000/innerWidth);canvas.width=Math.max(320,Math.floor(innerWidth*scale));canvas.height=Math.max(200,Math.floor(innerHeight*scale));ctx.imageSmoothingEnabled=false}addEventListener('resize',resize);resize();
let audio=null;function beep(freq=130,length=.12,type='sine',volume=.03){try{audio??=new (window.AudioContext||window.webkitAudioContext)();const osc=audio.createOscillator(),gain=audio.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,audio.currentTime);osc.frequency.exponentialRampToValueAtTime(Math.max(30,freq*.65),audio.currentTime+length);gain.gain.setValueAtTime(volume,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime+length);osc.connect(gain);gain.connect(audio.destination);osc.start();osc.stop(audio.currentTime+length)}catch{}}
function note(text){ui.prompt.textContent=text;clearTimeout(note.t);note.t=setTimeout(()=>{ui.prompt.textContent=''},2200)}
function reset(){player={...spawn,a:0,fuses:0};items.forEach(i=>i.got=false);ghost={x:13.5,y:7.5,phase:0,visible:false};fear=0;scare=0;won=dead=false;flashlight=true;updateHud()}
function updateHud(){ui.fuses.textContent=`FUSES: ${player.fuses} / 3`;ui.battery.textContent=`FLASHLIGHT: ${flashlight?'ON':'OFF'}`;ui.objective.textContent=player.fuses===3?'All fuses found — reach the EXIT':'Find the 3 missing fuses';ui.people.textContent=`PLAYERS: ${1+others.size}`}
function start(m){mode=m;running=true;reset();ui.overlay.style.display='none';last=performance.now();canvas.requestPointerLock?.();beep(160,.25,'triangle')}
function end(success){running=false;won=success;dead=!success;document.exitPointerLock?.();ui.overlay.style.display='flex';ui.message.textContent=success?'YOU ESCAPED! The last train finally arrived. Play again?':'THE SIGNAL WENT DARK. Try again — the tunnels have changed.';beep(success?490:65,.7,'sawtooth',.07)}
document.getElementById('solo').onclick=()=>{closeNet();start('solo')};
document.getElementById('host').onclick=()=>{start('online');createHost()};
document.getElementById('join').onclick=()=>{const code=ui.room.value.trim().toLowerCase().replace(/[^a-z0-9-]/g,'');if(!code){ui.message.textContent='Enter a room code first.';return}start('online');joinHost(code)};
function openMenu(message){running=false;document.exitPointerLock?.();ui.overlay.style.display='flex';ui.message.textContent=message||'Paused. Choose a mode to restart.'}
document.addEventListener('pointerlockchange',()=>{locked=document.pointerLockElement===canvas;if(!locked&&running){openMenu('Paused. Press PLAY SOLO or host/join to start again.')}});
canvas.addEventListener('click',()=>{if(running&&!locked)canvas.requestPointerLock?.()});
document.addEventListener('mousemove',e=>{if(locked&&running)player.a+=e.movementX*.0025});
document.addEventListener('keydown',e=>{keys[e.code]=true;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();if(e.repeat)return;if(e.code==='KeyF'&&running){flashlight=!flashlight;beep(410,.06);updateHud()}if(e.code==='KeyE'&&running)interact()});document.addEventListener('keyup',e=>keys[e.code]=false);
function interact(){for(const item of items){if(!item.got&&dist(player.x,player.y,item.x,item.y)<1.4){item.got=true;player.fuses++;beep(620,.25,'triangle');note('FUSE RECOVERED');updateHud();broadcast({type:'item',x:item.x,y:item.y});return}}if(player.fuses===3&&dist(player.x,player.y,exit.x,exit.y)<1.5){broadcast({type:'win'});end(true)}else note('Nothing to interact with here.')}
function move(x,y){const r=.22;if(!wall(x+r,player.y)&&!wall(x-r,player.y))player.x=x;if(!wall(player.x,y+r)&&!wall(player.x,y-r))player.y=y}
function update(dt){frame++;const speed=(keys.ShiftLeft||keys.ShiftRight?3.9:2.55)*dt;let f=0,s=0;if(keys.KeyW||keys.ArrowUp)f++;if(keys.KeyS||keys.ArrowDown)f--;if(keys.KeyD)s++;if(keys.KeyA)s--;const len=Math.hypot(f,s)||1;f/=len;s/=len;const dx=(Math.cos(player.a)*f-Math.sin(player.a)*s)*speed,dy=(Math.sin(player.a)*f+Math.cos(player.a)*s)*speed;move(player.x+dx,player.y+dy);if((f||s)&&frame%32===0)beep(56,.035,'triangle',.009);
// The watcher only pursues when close. It stays mild rather than relentless.
ghost.phase+=dt;const gd=dist(player.x,player.y,ghost.x,ghost.y);ghost.visible=gd<8||Math.sin(ghost.phase*.6)>.88;if(ghost.phase>16){ghost.phase=0;const choices=[[12.5,7.5],[17.5,13.5],[8.5,11.5],[19.5,5.5]];const c=choices[Math.floor(Math.random()*choices.length)];ghost.x=c[0];ghost.y=c[1]}
if(gd<5){fear=clamp(fear+dt*.12,0,1);if(gd<1.35&&fear>.35){scare=1;beep(70,.4,'sawtooth',.075);ghost.x=13.5;ghost.y=7.5;fear=.1}}else fear=clamp(fear-dt*.07,0,1);scare=Math.max(0,scare-dt*1.8);ambient+=dt;if(ambient>8+Math.random()*5){ambient=0;beep(80+Math.random()*100,.25,'sine',.013)}
if(mode==='online'){sendAcc+=dt;if(sendAcc>=1/20){sendAcc=0;broadcast({type:'pos',x:player.x,y:player.y,a:player.a})}}
}
function drawSprite(x,y,type){const dx=x-player.x,dy=y-player.y,d=Math.hypot(dx,dy),angle=Math.atan2(dy,dx)-player.a,da=Math.atan2(Math.sin(angle),Math.cos(angle));if(Math.abs(da)>Math.PI*.55||d<.1)return;const ray=cast(player.a+da);if(ray.distance<d-.25)return;const w=canvas.width,h=canvas.height,screenX=w/2+Math.tan(da)*w*.72,size=Math.min(h*2,h/(d*.6));const yTop=h/2-size*.65;if(type==='fuse'){ctx.fillStyle='#63e9b8';ctx.shadowColor='#2df0a4';ctx.shadowBlur=25;ctx.fillRect(screenX-size*.12,yTop+size*.2,size*.24,size*.4);ctx.fillStyle='#e5fff2';ctx.fillRect(screenX-size*.055,yTop+size*.28,size*.11,size*.22);ctx.shadowBlur=0}else if(type==='exit'){ctx.fillStyle='#5ab4e5';ctx.shadowColor='#5ab4e5';ctx.shadowBlur=20;ctx.fillRect(screenX-size*.3,yTop,size*.6,size*1.1);ctx.fillStyle='#05121a';ctx.fillRect(screenX-size*.22,yTop+size*.08,size*.44,size*.95);ctx.shadowBlur=0}else if(type==='ghost'){ctx.globalAlpha=clamp(.2+fear*.8,.25,.8);ctx.fillStyle='#080b0e';ctx.beginPath();ctx.ellipse(screenX,yTop+size*.55,size*.21,size*.62,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#c3e9df';ctx.fillRect(screenX-size*.11,yTop+size*.25,size*.06,size*.045);ctx.fillRect(screenX+size*.05,yTop+size*.25,size*.06,size*.045);ctx.globalAlpha=1}else if(type==='friend'){ctx.fillStyle='#617d72';ctx.fillRect(screenX-size*.14,yTop+size*.34,size*.28,size*.48);ctx.fillStyle='#b9c4b5';ctx.fillRect(screenX-size*.11,yTop+size*.13,size*.22,size*.21);ctx.fillStyle='#35483f';ctx.fillRect(screenX-size*.12,yTop+size*.81,size*.09,size*.32);ctx.fillRect(screenX+size*.03,yTop+size*.81,size*.09,size*.32)}}
function cast(a){const vx=Math.cos(a),vy=Math.sin(a);let d=0,x=player.x,y=player.y;while(d<28){d+=.035;x=player.x+vx*d;y=player.y+vy*d;if(wall(x,y))return{distance:d,x,y,side:Math.abs(x-Math.round(x))<.045?1:0}}return{distance:28,x,y,side:0}}
function render(){const w=canvas.width,h=canvas.height;ctx.fillStyle='#0d151b';ctx.fillRect(0,0,w,h/2);ctx.fillStyle='#161c1c';ctx.fillRect(0,h/2,w,h/2);const rayStep=Math.max(2,Math.round(w/520));for(let x=0;x<w;x+=rayStep){const angle=player.a+Math.atan((x/w-.5)*1.3),hit=cast(angle),d=Math.max(.12,hit.distance*Math.cos(angle-player.a)),height=Math.min(h*3,h/(d*.65)),shade=clamp(180/(1+d*.19),15,145)*(hit.side?.75:1),flicker=flashlight?Math.max(.2,1-Math.abs(x/w-.5)*1.5):.32,light=shade*flicker;ctx.fillStyle=`rgb(${light*.67|0},${light*.79|0},${light*.78|0})`;ctx.fillRect(x,h/2-height/2,rayStep+1,height);if(hit.distance<12&&Math.floor((hit.x+hit.y)*3)%8===0){ctx.fillStyle='rgba(0,0,0,.16)';ctx.fillRect(x,h/2-height/2,rayStep+1,height)}}
const sprites=[];for(const i of items)if(!i.got)sprites.push({...i,type:'fuse'});sprites.push({...exit,type:'exit'});if(ghost.visible)sprites.push({...ghost,type:'ghost'});for(const p of others.values())sprites.push({...p,type:'friend'});sprites.sort((a,b)=>dist(player.x,player.y,b.x,b.y)-dist(player.x,player.y,a.x,a.y));for(const s of sprites)drawSprite(s.x,s.y,s.type);
// Film grain, distant emergency light, and a brief non-graphic scare.
ctx.fillStyle=`rgba(0,0,0,${flashlight?.09:.5})`;ctx.fillRect(0,0,w,h);if(Math.sin(performance.now()*.0015)> .94){ctx.fillStyle='rgba(130,16,12,.045)';ctx.fillRect(0,0,w,h)}if(scare>0){ctx.fillStyle=`rgba(140,15,12,${scare*.28})`;ctx.fillRect(0,0,w,h);ctx.fillStyle=`rgba(220,230,220,${scare*.4})`;ctx.font=`bold ${Math.floor(h*.22)}px sans-serif`;ctx.textAlign='center';ctx.fillText('DON’T LOOK BACK',w/2,h*.4)}
if(running){let near=false;for(const i of items)if(!i.got&&dist(player.x,player.y,i.x,i.y)<1.4)near=true;if(near)ui.prompt.textContent='PRESS E — PICK UP FUSE';else if(player.fuses===3&&dist(player.x,player.y,exit.x,exit.y)<1.5)ui.prompt.textContent='PRESS E — ESCAPE';else if(!ui.prompt.textContent.startsWith('FUSE'))ui.prompt.textContent=''}
}
function loop(now){const dt=Math.min(.05,(now-last)/1000||0);last=now;if(running)update(dt);render();requestAnimationFrame(loop)}requestAnimationFrame(loop);
// Optional online mode. Offline solo never loads PeerJS.
function loadPeer(){return new Promise((resolve,reject)=>{if(window.Peer)return resolve();const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';s.onload=resolve;s.onerror=()=>reject(Error('Cannot load online networking. Solo still works offline.'));document.head.appendChild(s)})}
function code(){return Math.random().toString(36).slice(2,8)}
function closeNet(){try{peer?.destroy()}catch{}peer=null;hostConn=null;connections.clear();others.clear();isHost=false;updateHud()}
async function createHost(){closeNet();try{await loadPeer();roomCode=code();hostID='whisper-station-'+roomCode;peer=new Peer(hostID);peer.on('open',()=>{isHost=true;connectionState='hosting';note('ROOM CODE: '+roomCode);ui.room.value=roomCode;ui.objective.textContent='ROOM '+roomCode+' — SHARE THIS CODE';});peer.on('connection',conn=>{connections.set(conn.peer,conn);attach(conn);conn.on('open',()=>{conn.send({type:'snapshot',items:items.map(i=>i.got),players:[...others.values()].map(p=>({id:p.id,x:p.x,y:p.y,a:p.a})),host:{id:peer.id,x:player.x,y:player.y,a:player.a}});updateHud()})});peer.on('error',e=>{note('Network error: '+e.type);console.error(e)})}catch(e){note(e.message);console.error(e)}}
async function joinHost(room){closeNet();try{await loadPeer();peer=new Peer();peer.on('open',()=>{hostConn=peer.connect('whisper-station-'+room,{reliable:true});attach(hostConn);hostConn.on('open',()=>{note('CONNECTED TO '+room);connectionState='connected';hostConn.send({type:'hello',x:player.x,y:player.y,a:player.a})})});peer.on('error',e=>{note('Connection error: '+e.type);console.error(e)})}catch(e){note(e.message);console.error(e)}}
function attach(conn){conn.on('data',data=>receive(data,conn));conn.on('close',()=>{others.delete(conn.peer);connections.delete(conn.peer);updateHud();if(!isHost)note('HOST DISCONNECTED — SOLO CONTINUES')});conn.on('error',e=>console.warn('Connection:',e))}
function broadcast(data,except=null){if(isHost){for(const conn of connections.values())if(conn.open&&conn!==except)conn.send({...data,id:data.id||peer.id})}else if(hostConn?.open)hostConn.send({...data,id:peer.id})}
function receive(data,source){if(!data||typeof data!=='object')return;const id=data.id||source.peer;if(data.type==='snapshot'){items.forEach((item,i)=>item.got=!!data.items?.[i]);player.fuses=items.filter(i=>i.got).length;others.clear();for(const p of data.players||[])if(p.id!==peer.id)others.set(p.id,p);if(data.host)others.set(data.host.id,data.host);updateHud();return}
if(data.type==='hello'||data.type==='pos'){if(Number.isFinite(data.x)&&Number.isFinite(data.y)&&Number.isFinite(data.a)&&!wall(data.x,data.y)){others.set(id,{id,x:data.x,y:data.y,a:data.a});updateHud();if(isHost)broadcast({...data,id},source)}return}
if(data.type==='item'){const item=items.find(i=>i.x===data.x&&i.y===data.y);if(item&&!item.got){item.got=true;player.fuses=items.filter(i=>i.got).length;updateHud();beep(620,.15);note('YOUR TEAM FOUND A FUSE')}if(isHost)broadcast({...data,id},source);return}
if(data.type==='win'){if(isHost)broadcast({...data,id},source);if(running)end(true)}}
})();
