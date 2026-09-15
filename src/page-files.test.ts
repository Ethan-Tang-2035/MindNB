import {it,expect} from 'vitest'
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {savePageFiles} from '../desktop/page-files.ts'
it('批量桌面导出独占创建文件，不覆盖重名文件且提前拒绝无效格式',async()=>{const folder=await mkdtemp(join(tmpdir(),'mindnb-pages-'));try{const first=await savePageFiles(folder,[{name:'01-封面',extension:'png',bytes:new Uint8Array([1,2])}]);const second=await savePageFiles(folder,[{name:'01-封面',extension:'png',bytes:new Uint8Array([3,4])}]);expect(first[0]).not.toBe(second[0]);expect([...await readFile(first[0])]).toEqual([1,2]);await expect(savePageFiles(folder,[{name:'合法',extension:'png',bytes:new Uint8Array([5])},{name:'无效',extension:'exe',bytes:new Uint8Array([6])}])).rejects.toThrow();expect(await readdir(folder)).toHaveLength(2)}finally{await rm(folder,{recursive:true,force:true})}})
