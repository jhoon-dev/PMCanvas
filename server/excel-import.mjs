import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import {fileJob} from './file-jobs.mjs';

function inspectZip(buffer){
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('유효한 XLSX 파일이 아닙니다.');
 const count=buffer.readUInt16LE(end+10);let offset=buffer.readUInt32LE(end+16),size=0;
 if(count>2000||buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6))throw Error('지원하지 않는 압축 형식입니다.');
 for(let i=0;i<count;i++){
  if(offset+46>buffer.length||buffer.readUInt32LE(offset)!==0x02014b50)throw Error('압축 파일이 손상되었습니다.');
  size+=buffer.readUInt32LE(offset+24);const len=buffer.readUInt16LE(offset+28),name=buffer.subarray(offset+46,offset+46+len).toString();
  if(size>32*1024*1024||buffer.readUInt16LE(offset+8)&1||/vbaProject|externalLinks|\.\.\//i.test(name))throw Error('압축 해제 크기 초과 또는 매크로·외부 연결 파일은 가져올 수 없습니다.');
  offset+=46+len+buffer.readUInt16LE(offset+30)+buffer.readUInt16LE(offset+32);
 }
}
export async function parseWorkbook(buffer){
 if(buffer.length>4*1024*1024)throw Error('Excel 파일은 4MB 이하로 선택해 주세요.');inspectZip(buffer);await validateInflation(buffer);
 const book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
 if(book.worksheets.length>12)throw Error('시트는 12개까지 지원합니다.');
 return book.worksheets.map(sheet=>{
  if(sheet.rowCount>501||sheet.columnCount>40)return {name:sheet.name,rows:[],error:'이 시트는 머리글 포함 501행·40열 제한을 초과합니다.'};
  const rows=[];for(let n=1;n<=sheet.rowCount;n++){
   const values=[];for(let c=1;c<=sheet.columnCount;c++){const cell=sheet.getCell(n,c),v=cell.value;
    if(v&&typeof v==='object'&&('formula' in v||'sharedFormula' in v||'error' in v))throw Error(sheet.name+' '+cell.address+': 수식·오류 셀을 값으로 바꿔 주세요.');
    const value=v instanceof Date?v.toISOString().slice(0,10):typeof v==='object'&&v!==null?cell.text:v??'';
    if(String(value).length>2000)throw Error(sheet.name+' '+cell.address+': 셀은 2,000자까지 지원합니다.');values.push(value);
   }rows.push(values);
  }return {name:sheet.name,rows};
 });
}
export async function readWorkbook(base64){
 if(typeof base64!=='string'||base64.length>5592408||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw Error('Excel 파일 형식을 확인해 주세요.');
 return JSON.parse((await fileJob('import',{file:base64})).toString());
}
async function validateInflation(buffer){
 return new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
  if(error)return reject(Error('유효한 XLSX 파일이 아닙니다.'));let total=0,count=0;const names=new Set();const failed=error=>{zip.close();reject(error);};
  zip.on('error',failed);zip.on('end',resolve);zip.on('entry',entry=>{
   if(++count>2000||names.has(entry.fileName)||entry.uncompressedSize>32*1024*1024)return failed(Error('압축 항목 제한을 초과했습니다.'));names.add(entry.fileName);
   zip.openReadStream(entry,(error,stream)=>{if(error)return failed(error);stream.on('error',failed);stream.on('data',chunk=>{total+=chunk.length;if(total>32*1024*1024){stream.destroy();failed(Error('실제 압축 해제 크기가 32MB를 초과합니다.'));}});stream.on('end',()=>zip.readEntry());});
  });zip.readEntry();
 }));
}
