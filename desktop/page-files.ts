import { open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExportSaveRequest } from '../src/desktop-commands.ts'
import { MAX_PACKAGE_BYTES } from '../src/vault-format.ts'
/** Exclusive creation prevents overwrites even if another process writes after the picker closes. */
export async function savePageFiles(folder:string,files:ExportSaveRequest[]):Promise<string[]> {
 if(!Array.isArray(files)||!files.length||files.length>500||files.some(f=>!f||typeof f.name!=='string'||!['png','jpg'].includes(f.extension)||!(f.bytes instanceof Uint8Array)||!f.bytes.length)||files.reduce((n,f)=>n+f.bytes.length,0)>MAX_PACKAGE_BYTES)throw new Error('无效的批量图片或总容量超出 128 MB')
 const written:string[]=[]
 try {for(const file of files){const base=file.name.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').trim().slice(0,110)||'纸页';let saved=false
  for(let index=0;index<10000;index++){const path=join(folder,`${base}${index?` (${index+1})`:''}.${file.extension}`);try{const handle=await open(path,'wx');written.push(path);try{await handle.writeFile(file.bytes)}finally{await handle.close()}saved=true;break}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')continue;
    throw e}}
  if(!saved)throw new Error('重名文件过多，请选择其他文件夹')
 }return written}catch(e){const cleanup=await Promise.allSettled(written.map(path=>unlink(path)));if(cleanup.some(r=>r.status==='rejected'))throw new Error('保存未完成，部分文件未能回退，请检查所选文件夹');throw e}
}
