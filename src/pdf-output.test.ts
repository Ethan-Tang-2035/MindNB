import { expect, it } from 'vitest'
import { jsPDF } from 'jspdf'
import { pdfOutput } from './pdf-output.ts'

it('stabilizes PDF retry bytes while distinguishing changed content', async () => {
  const make = async (text: string, date: string, fileId: string) => {
    const pdf = new jsPDF({ compress: true })
    pdf.text(text, 10, 10)
    pdf.setCreationDate(date)
    pdf.setFileId(fileId)
    return new Uint8Array(await (await pdfOutput(pdf)).arrayBuffer())
  }
  const first = await make('same content', "D:20260101000000+00'00'", '1'.repeat(32))
  expect(await make('same content', "D:20260914120000+00'00'", '2'.repeat(32))).toEqual(first)
  expect(await make('changed content', "D:20260101000000+00'00'", '1'.repeat(32))).not.toEqual(first)
})
