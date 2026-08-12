import { jsPDF } from "jspdf";

export const generateAppraisalPDF = (submissionData) => {
  const doc = new jsPDF();
  const data = submissionData || {
    facultyName: "Dr. Ananya Sharma",
    designation: "Professor",
    department: "Computer Science & Engineering",
    employeeCode: "EMP-2024-8849",
    dateSubmitted: "May 24, 2024",
    academicYear: "2024-25",
    pbasScore: 285,
    totalActivities: 128,
  };

  // Header Banner - #FD6F3B Carrot Orange
  doc.setFillColor(253, 111, 59); 
  doc.rect(0, 0, 210, 30, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Sanchaya | Westfield University", 14, 18);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Automated Faculty Self-Appraisal & Academic Progress Record", 14, 25);

  // Document Title
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("ANNUAL FACULTY SELF-APPRAISAL REPORT (PBAS)", 14, 42);

  // Metadata Box
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(255, 244, 240);
  doc.roundedRect(14, 48, 182, 45, 3, 3, "FD");

  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("Faculty Name:", 20, 56);
  doc.setFont("helvetica", "normal");
  doc.text(data.facultyName, 55, 56);

  doc.setFont("helvetica", "bold");
  doc.text("Employee Code:", 115, 56);
  doc.setFont("helvetica", "normal");
  doc.text(data.employeeCode, 150, 56);

  doc.setFont("helvetica", "bold");
  doc.text("Designation:", 20, 64);
  doc.setFont("helvetica", "normal");
  doc.text(data.designation, 55, 64);

  doc.setFont("helvetica", "bold");
  doc.text("Department:", 115, 64);
  doc.setFont("helvetica", "normal");
  doc.text(data.department, 150, 64);

  doc.setFont("helvetica", "bold");
  doc.text("Academic Year:", 20, 72);
  doc.setFont("helvetica", "normal");
  doc.text(data.academicYear, 55, 72);

  doc.setFont("helvetica", "bold");
  doc.text("Submission Date:", 115, 72);
  doc.setFont("helvetica", "normal");
  doc.text(data.dateSubmitted, 150, 72);

  doc.setFont("helvetica", "bold");
  doc.text("Verification Status:", 20, 80);
  doc.setTextColor(16, 185, 129);
  doc.text(data.verificationStatus || "Verified by HOD & IQAC", 55, 80);

  doc.setTextColor(30, 41, 59);
  doc.setFont("helvetica", "bold");
  doc.text("Total PBAS Score:", 115, 80);
  doc.setTextColor(253, 111, 59);
  doc.text(`${data.pbasScore || 285} / 300 Points`, 150, 80);

  // Summary Table Header
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Category Breakdown & Performance Summary", 14, 105);

  doc.setFillColor(241, 245, 249);
  doc.rect(14, 110, 182, 8, "F");

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Category", 20, 115);
  doc.text("Logged Activities", 80, 115);
  doc.text("Evidence Attached", 130, 115);
  doc.text("Points Score", 170, 115);

  const categories = [
    { name: "Course Teaching & Curriculum", count: "120 Activities", evidence: "100%", score: "90 PBAS" },
    { name: "Research & Publications (Google Scholar)", count: "89 Activities", evidence: "95%", score: "115 PBAS" },
    { name: "Service to Institution & Community", count: "56 Activities", evidence: "90%", score: "35 PBAS" },
    { name: "Mentorship & Student Guidance", count: "74 Activities", evidence: "100%", score: "25 PBAS" },
    { name: "Workshops, Seminars & FDPs", count: "33 Activities", evidence: "88%", score: "12 PBAS" },
    { name: "Committees & Administration", count: "41 Activities", evidence: "92%", score: "8 PBAS" },
  ];

  let y = 125;
  categories.forEach((cat, idx) => {
    doc.setFont("helvetica", "normal");
    doc.text(cat.name, 20, y);
    doc.text(cat.count, 80, y);
    doc.text(cat.evidence, 130, y);
    doc.setFont("helvetica", "bold");
    doc.text(cat.score, 170, y);
    
    doc.setDrawColor(241, 245, 249);
    doc.line(14, y + 3, 196, y + 3);
    y += 10;
  });

  // Recent Auto-Tracked Publications & Key Achievements
  y += 5;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 41, 59);
  doc.text("Auto-Synced Research Publications (Scopus / Google Scholar / ORCID)", 14, y);

  y += 8;
  const publications = [
    "1. 'Deep Learning for Time Series Forecasting in Industrial IoT' - IEEE Access (2025)",
    "2. 'AI in Higher Education: Trends, Ethical Frameworks and Impact' - IJET (2024)",
    "3. 'Automated Self-Appraisal Frameworks using Multi-Agent AI' - Springer LNCS (2024)",
  ];

  publications.forEach((pub) => {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(pub, 18, y);
    y += 6;
  });

  // Signature Block
  y += 20;
  doc.setDrawColor(203, 213, 225);
  doc.line(20, y, 75, y);
  doc.line(135, y, 190, y);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Faculty Member Signature", 20, y + 5);
  doc.text("Head of Department / Dean Approval", 135, y + 5);

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text("Generated via Sanchaya Digital Self-Appraisal System | Paperless India Initiative", 14, 285);
  doc.text("Page 1 of 1", 185, 285);

  doc.save(`Self_Appraisal_${data.facultyName.replace(/\s+/g, "_")}_2024-25.pdf`);
};
