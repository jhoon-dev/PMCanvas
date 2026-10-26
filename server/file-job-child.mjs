if(process.argv[2]==='--file-job'){
 try{const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>8*1024*1024)throw Error('파일 요청은 8MB 이하로 보내 주세요.');chunks.push(chunk);}const input=JSON.parse(Buffer.concat(chunks));
  if(process.argv[3]==='import'){const {parseWorkbook}=await import('./excel-import.mjs');process.stdout.write(JSON.stringify(await parseWorkbook(Buffer.from(input.file,'base64'))));}
  else if(process.argv[3]==='export'){const {buildWorkbook}=await import('./excel.mjs');process.stdout.write(await buildWorkbook(input.project,input.at,input.ids,input.options));}
  else throw Error('지원하지 않는 파일 작업입니다.');
 }catch(error){process.stderr.write(error.message);process.exitCode=1;}
}
