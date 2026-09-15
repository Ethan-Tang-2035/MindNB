import type { jsPDF } from 'jspdf'
import { digest } from './vault-format.ts'

/** Exports have no source creation timestamp. Stable metadata lets identical
 * exports be retried without the desktop bridge treating them as new content. */
export async function pdfOutput(pdf: jsPDF): Promise<Blob> {
  pdf.setCreationDate("D:19800101000000+00'00'")
  pdf.setFileId('0'.repeat(32))
  const contentId = await digest(new Uint8Array(pdf.output('arraybuffer')))
  pdf.setFileId(contentId.slice(0, 32))
  return pdf.output('blob')
}
