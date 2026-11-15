// Rendert reel.html Frame für Frame (30 fps) und pipet die Bilder in ffmpeg.
const {chromium}=require('playwright');const {spawn}=require('child_process');const path=require('path');const fs=require('fs');
const FPS=30, out=process.argv[2]||'reel_noaudio.mp4';
(async()=>{
  const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});
  await p.goto('file://'+path.resolve(__dirname,'reel.html'));await p.waitForTimeout(400);
  const cues=await p.evaluate(()=>window.AUDIO_CUES);fs.writeFileSync(path.join(path.dirname(out),'cues.json'),JSON.stringify(cues));
  const ff=spawn('ffmpeg',['-v','error','-y','-f','image2pipe','-framerate',String(FPS),'-c:v','mjpeg','-i','-','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-r',String(FPS),out],{stdio:['pipe','inherit','inherit']});
  const n=Math.round(cues.dur*FPS);
  for(let i=0;i<n;i++){await p.evaluate(t=>render(t),i/FPS);const buf=await p.screenshot({type:'jpeg',quality:93,scale:'css'});
    if(!ff.stdin.write(buf))await new Promise(r=>ff.stdin.once('drain',r));if(i%150==0)console.log('frame',i,'/',n);}
  ff.stdin.end();await new Promise(r=>ff.on('close',r));await b.close();console.log('fertig',out);
})();
