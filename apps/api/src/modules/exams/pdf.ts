import type { ReportCardOut } from '@school-sync/shared';
import { pdfSafe, renderPdf } from './common';

const fmt = (n: number | null | undefined, digits = 2) => (n == null ? '-' : Number.isInteger(n) ? String(n) : n.toFixed(digits).replace(/0+$/, '').replace(/\.$/, ''));

/** A4 report card. Built-in Helvetica only: names in non-Latin scripts are transliterated/dropped by `pdfSafe`. */
export function reportCardPdf(card: ReportCardOut): Promise<Buffer> {
  return renderPdf(
    (doc) => {
      const left = 40;
      const width = doc.page.width - 80;
      doc.font('Helvetica-Bold').fontSize(18).text(pdfSafe(card.school.name), left, 40, { width, align: 'center' });
      doc.font('Helvetica').fontSize(9).fillColor('#555555');
      const contact = [card.school.address, card.school.phone, card.school.email].map(pdfSafe).filter(Boolean).join('  |  ');
      if (contact) doc.text(contact, { width, align: 'center' });
      doc.moveDown(0.8).fillColor('#000000').font('Helvetica-Bold').fontSize(14).text(`Report Card - ${pdfSafe(card.examName)}`, { width, align: 'center' });
      if (card.academicYear || card.termName) doc.font('Helvetica').fontSize(10).text([card.academicYear, card.termName].filter(Boolean).join('  |  '), { width, align: 'center' });
      if (!card.complete) doc.moveDown(0.3).font('Helvetica-Oblique').fontSize(9).fillColor('#b45309').text(`PROVISIONAL - ${card.subjectsPublished} of ${card.subjectsExpected} subjects published so far`, { width, align: 'center' }).fillColor('#000000');

      doc.moveDown(0.8);
      const info: [string, string][] = [
        ['Student', pdfSafe(card.studentName)],
        ['Admission no.', card.admissionNo],
        ['Class', [card.gradeName, card.sectionName].filter(Boolean).join(' ')],
        ['Roll no.', card.rollNo == null ? '-' : String(card.rollNo)],
      ];
      let y = doc.y;
      info.forEach(([k, v], i) => {
        const x = left + (i % 2) * (width / 2);
        const yy = y + Math.floor(i / 2) * 16;
        doc.font('Helvetica').fontSize(9).fillColor('#555555').text(`${k}:`, x, yy, { continued: false, width: 80 });
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000').text(pdfSafe(v), x + 82, yy, { width: width / 2 - 90 });
      });
      y += 40;

      // subjects table
      const cols = [
        { t: 'Subject', w: width * 0.34, a: 'left' as const },
        { t: 'Max', w: width * 0.12, a: 'right' as const },
        { t: 'Marks', w: width * 0.14, a: 'right' as const },
        { t: '%', w: width * 0.12, a: 'right' as const },
        { t: 'Grade', w: width * 0.12, a: 'center' as const },
        { t: 'Result', w: width * 0.16, a: 'center' as const },
      ];
      const row = (cells: string[], yy: number, bold = false, fill?: string) => {
        if (fill) doc.rect(left, yy - 3, width, 17).fill(fill).fillColor('#000000');
        let x = left;
        cells.forEach((c, i) => {
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#000000').text(c, x + 4, yy, { width: cols[i]!.w - 8, align: cols[i]!.a, lineBreak: false });
          x += cols[i]!.w;
        });
      };
      row(cols.map((c) => c.t), y, true, '#e5e7eb');
      y += 18;
      for (const s of card.subjects) {
        row([pdfSafe(s.subjectName), fmt(s.maxMarks), s.isAbsent ? 'AB' : fmt(s.marksObtained), fmt(s.percent), s.grade ?? '-', s.isAbsent ? 'Absent' : s.passed ? 'Pass' : 'Fail'], y);
        y += 16;
      }
      doc.moveTo(left, y - 2).lineTo(left + width, y - 2).strokeColor('#9ca3af').stroke();
      row(['Total', fmt(card.maxTotal), fmt(card.totalMarks), fmt(card.percent), card.grade ?? '-', card.result ? card.result.toUpperCase() : '-'], y + 2, true, '#f3f4f6');
      y += 28;

      doc.font('Helvetica').fontSize(10).fillColor('#000000');
      const summary = [`Class rank: ${card.rank == null ? '-' : `${card.rank} of ${card.classSize}${card.complete ? '' : ' (provisional)'}`}`, `Pass mark: ${fmt(card.passPercent)}%`];
      if (card.gradeRemark) summary.push(`Grade remark: ${pdfSafe(card.gradeRemark)}`);
      doc.text(summary.join('     '), left, y, { width });
      y = doc.y + 8;

      if (card.attendance) {
        const a = card.attendance;
        doc.font('Helvetica-Bold').fontSize(10).text('Attendance', left, y);
        doc.font('Helvetica').fontSize(9).text(`${a.from} to ${a.to}: ${a.percent == null ? 'no attendance recorded' : `${fmt(a.percent)}%`}   (present ${a.present}, late ${a.late}, half day ${a.halfDay}, leave ${a.leave}, absent ${a.absent}; ${a.totalDays} days recorded)`, left, doc.y, { width });
        y = doc.y + 8;
      }
      if (card.remarks) {
        doc.font('Helvetica-Bold').fontSize(10).text("Class teacher's remarks", left, y);
        doc.font('Helvetica').fontSize(9);
        if (card.remarks.remark) doc.text(pdfSafe(card.remarks.remark), left, doc.y, { width });
        if (card.remarks.areasToImprove) doc.text(`Areas to improve: ${pdfSafe(card.remarks.areasToImprove)}`, left, doc.y + 2, { width });
        if (card.remarks.conduct) doc.text(`Conduct: ${pdfSafe(card.remarks.conduct)}`, left, doc.y + 2, { width });
        y = doc.y + 8;
      }
      doc.font('Helvetica-Bold').fontSize(9).text('Grading scale', left, y);
      doc.font('Helvetica').fontSize(8).fillColor('#444444').text(card.gradeScale.map((b) => `${b.label}: ${fmt(b.minPercent)}-${fmt(b.maxPercent)}%`).join('   '), left, doc.y, { width });
      doc.fillColor('#6b7280').fontSize(7).text(`Generated ${new Date().toISOString().slice(0, 10)} by SchoolSync`, left, doc.page.height - 56, { width, align: 'right' });
    },
    { title: `Report card - ${card.studentName} - ${card.examName}`, author: card.school.name },
  );
}
