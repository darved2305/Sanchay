"""Generate a fresh demo set: one file per feature and per classifier leaf.

The fixtures written by ``generate_fixtures.py`` and
``generate_repository_samples.py`` have already been imported into the live
dashboard, so re-uploading them during a demo either collides with existing
records or is silently skipped as a duplicate. Everything here is *new*
content -- a different faculty persona, different students, different
companies -- so each file lands as a fresh record.

Coverage is driven by the code, not by a hand-written list: the repository
documents are generated from ``repository_classify.TAXONOMY`` itself, so every
(category, type) leaf the classifier can emit gets a demo document. Each is
written with text chosen to hit that leaf's keyword rule, and the script
verifies that by running the real classifier over what it just wrote.

Run from anywhere:
    .venv/bin/python test-files/generate_demo_files.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import openpyxl
import pymupdf
from docx import Document
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT.parent / "backend"))

from app.services.repository_classify import TAXONOMY, classify_deterministic  # noqa: E402

# A different professor from the one in generate_fixtures.py, so a demo import
# creates new activities instead of colliding with records already on file.
FACULTY = "Dr. Meera Iyer"
DEPARTMENT = "Department of Information Technology"
COLLEGE = "Dwarkadas J. Sanghvi College of Engineering"
STUDENT = "Aditi Kulkarni"
ROLL_NUMBER = "BE-IT-2027-0318"


def write_pdf(path: Path, lines: list[str]) -> None:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((60, 70), "\n".join(lines), fontsize=10.5, lineheight=1.35)
    path.parent.mkdir(parents=True, exist_ok=True)
    document.save(path)
    document.close()


def write_docx(path: Path, lines: list[str]) -> None:
    document = Document()
    for line in lines:
        document.add_paragraph(line)
    path.parent.mkdir(parents=True, exist_ok=True)
    document.save(path)


def write_xlsx(path: Path, rows: list[list[object]]) -> None:
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(row)
    path.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(path)


def write_image(path: Path, lines: list[str]) -> None:
    try:
        font = ImageFont.truetype("arial.ttf", 28)
    except OSError:
        font = ImageFont.load_default()
    image = Image.new("RGB", (1000, 700), color="white")
    draw = ImageDraw.Draw(image)
    y = 40
    for line in lines:
        draw.text((40, y), line, fill="black", font=font)
        y += 44
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="JPEG", quality=92)


def letterhead(issuer: str, ref: str) -> list[str]:
    return [issuer, "", f"Ref: {ref}", "Date: 26 August 2026", ""]


# --- Repository documents: one per (category, type) leaf ---------------------
#
# ``body`` must contain the keyword that maps to its leaf in
# _KEYWORD_RULES, and must NOT contain any keyword listed earlier in those
# rules (first match wins). The verification pass at the end enforces this.
LEAF_BODIES: dict[tuple[str, str], list[str]] = {
    ("research", "Journal Article"): [
        "Journal Article - Accepted Version", "",
        "Title: Edge-Aware Scheduling for Real-Time IoT Telemetry",
        f"Author: {FACULTY}, {DEPARTMENT}",
        "Journal of Distributed Computing Systems, Volume 41, Issue 3, 2026",
        "DOI: 10.4021/jdcs.2026.41.3.118",
    ],
    ("research", "Conference Paper"): [
        "Conference Paper - Camera Ready", "",
        "Title: Latency Budgets in Federated Edge Inference",
        f"Author: {FACULTY}", "Presented at ACM SIGCOMM Workshop, Bengaluru, March 2026",
    ],
    ("research", "Preprint"): [
        "Preprint - Not Peer Reviewed", "",
        "Title: A Survey of Consensus Protocols for Campus Sensor Networks",
        f"Author: {FACULTY}", "arXiv:2603.04471v1 [cs.DC]",
    ],
    ("research", "Book Chapter"): [
        "Book Chapter", "",
        "Chapter 7: Privacy Foundations for Smart Campus Systems",
        "In: Handbook of Applied Distributed Computing, Springer, 2026",
        f"Contributing author: {FACULTY}",
    ],
    ("research", "Patent"): [
        "Patent Application - Filing Acknowledgement", "",
        "Application No: 202621034887", "Title: Adaptive Sensor Gateway For Campus Networks",
        f"Inventor: {FACULTY}", "Indian Patent Office, Mumbai",
    ],
    ("research", "Research Proposal"): [
        "Research Proposal", "",
        "Title: Resilient Telemetry Pipelines for Tier-2 Campuses",
        f"Principal Investigator: {FACULTY}", "Duration: 24 months",
    ],
    ("research", "Grant Proposal"): [
        "Grant Proposal - Submitted for Consideration", "",
        "Scheme: AICTE Research Promotion Scheme 2026",
        f"Principal Investigator: {FACULTY}", "Amount sought: INR 18,40,000",
    ],
    ("research", "Grant Approval"): [
        "Grant Approval Letter", "",
        "Scheme: AICTE Research Promotion Scheme 2026",
        f"This is to convey approval of the grant to {FACULTY}.",
        "Amount approved: INR 18,40,000",
    ],
    ("research", "Reviewer Acknowledgement"): [
        "Reviewer Acknowledgement", "",
        f"We thank {FACULTY} for reviewing submissions for the",
        "Journal of Distributed Computing Systems during 2026.",
    ],
    ("research", "Research Statement"): [
        "Research Statement", "",
        f"Prepared by {FACULTY}, {DEPARTMENT}",
        "My work concerns dependable data movement in constrained campus networks.",
    ],
    ("research", "Project Report"): [
        "Funded Project Report - Final Technical Submission", "",
        f"Investigator: {FACULTY}", "Outcome: Deployed pilot across four campus buildings.",
    ],
    ("teaching", "Syllabus"): [
        "Course Syllabus - IT402 Distributed Systems", "",
        f"Instructor: {FACULTY}", "Unit 1: Time and Ordering", "Unit 2: Replication",
        "Unit 3: Consensus", "Unit 4: Fault Tolerance",
    ],
    ("teaching", "Lecture Material"): [
        "Lecture Notes - IT402 Unit 3", "",
        "Topic: Consensus without synchrony", f"Prepared by {FACULTY}",
    ],
    ("teaching", "Lab Manual"): [
        "Lab Manual - IT402 Distributed Systems Laboratory", "",
        "Experiment 4: Implementing a replicated key-value store",
    ],
    ("teaching", "Assignment"): [
        "Assignment 2 - IT402", "",
        "Implement vector clocks and demonstrate causal ordering.",
        "Submission deadline: 20 September 2026",
    ],
    ("teaching", "Question Paper"): [
        "End Semester Question Paper", "",
        "IT402 Distributed Systems | Max Marks: 80 | Duration: 3 hours",
        "Q1. Explain the FLP impossibility result.",
    ],
    ("teaching", "Assessment Material"): [
        "Continuous Assessment Rubric", "",
        "IT402 Distributed Systems", "Assessment weightage: internals 40, endsem 60",
    ],
    ("teaching", "Course Report"): [
        "Course Report - IT402 Distributed Systems", "",
        f"Faculty: {FACULTY}", "Enrolled: 68 | Passed: 64 | Average attendance: 88%",
    ],
    ("professional_development", "FDP Certificate"): [
        "FDP Certificate", "",
        f"This certifies that {FACULTY} attended the Faculty Development Programme",
        "on Applied Distributed Systems, IIT Madras, 10-14 August 2026.",
    ],
    ("professional_development", "Workshop Certificate"): [
        "Workshop Certificate", "",
        f"Awarded to {FACULTY} for completing the hands-on Kubernetes Operations",
        "workshop conducted by NPTEL, July 2026.",
    ],
    ("professional_development", "Seminar Certificate"): [
        "Seminar Certificate", "",
        f"Presented to {FACULTY} for participation in the National Seminar on",
        "Responsible Computing, Pune, June 2026.",
    ],
    ("professional_development", "Conference Certificate"): [
        "Conference Certificate", "",
        f"This is to certify that {FACULTY} attended the International Conference",
        "on Emerging Networks, Hyderabad, 2026.",
    ],
    ("academic_service", "Committee Letter"): [
        *letterhead(COLLEGE, "DJS/ACAD/2026/442"),
        f"Sub: Nomination to the Academic Monitoring Committee", "",
        f"Dear {FACULTY},", "",
        "You are nominated to the departmental committee for the year 2026-27.",
    ],
    ("academic_service", "Examiner Appointment"): [
        *letterhead("University of Mumbai", "MU/EXAM/2026/1187"),
        "Sub: Examiner Appointment - Semester VII Practical Examinations", "",
        f"Dear {FACULTY},", "",
        "You are appointed as external examiner for the forthcoming examinations.",
    ],
    ("academic_service", "Viva Letter"): [
        *letterhead("University of Mumbai", "MU/RES/2026/0904"),
        "Sub: Viva Voce Examination - Doctoral Candidate", "",
        f"Dear {FACULTY},", "",
        "You are requested to conduct the viva voce examination on 12 October 2026.",
    ],
    ("academic_service", "BOS Letter"): [
        *letterhead("University of Mumbai", "MU/BOS/2026/0233"),
        "Sub: Board of Studies - Information Technology", "",
        f"Dear {FACULTY},", "",
        "You are inducted as a member of the Board of Studies for a term of three years.",
    ],
    ("academic_service", "Reviewer Certificate"): [
        "Reviewer Certificate", "",
        f"Issued to {FACULTY} in recognition of service as a technical reviewer",
        "for the International Conference on Emerging Networks, 2026.",
    ],
    ("student_mentorship", "OJT Letter"): [
        *letterhead("Deloitte India (Offices of the US)", "DEL/OJT/2026/7741"),
        "Sub: On the Job Training - Completion", "",
        f"This is to certify that {STUDENT} ({ROLL_NUMBER}) of {COLLEGE}",
        "completed OJT with our Risk Analytics practice from 05 Jan 2026 to 30 Jun 2026.",
        f"Faculty mentor: {FACULTY}",
    ],
    ("student_mentorship", "Internship Offer"): [
        *letterhead("Amazon Development Centre India", "ADCI/INT/2026/3318"),
        "Sub: Internship Offer - Software Development Engineer Intern", "",
        f"Dear {STUDENT},", "",
        "We are pleased to offer you a summer internship at our Bengaluru office.",
        "Stipend: INR 1,10,000 per month | Duration: 12 weeks",
    ],
    ("student_mentorship", "Internship Completion"): [
        *letterhead("Infosys Limited", "INFY/ICL/2026/9052"),
        "Sub: Internship Completion Certificate", "",
        f"This is to certify that {STUDENT} completed the internship programme",
        "with the Data Platforms group between January and June 2026.",
    ],
    ("student_mentorship", "Placement Offer"): [
        *letterhead("Goldman Sachs Services India", "GS/PLC/2026/2214"),
        "Sub: Placement Offer - Analyst, Engineering Division", "",
        f"Dear {STUDENT},", "",
        "We are delighted to extend this placement offer for our Bengaluru office.",
        "Annual CTC: INR 32,00,000 | Joining: 06 July 2027",
    ],
    ("student_mentorship", "Student Achievement"): [
        "Student Achievement Record", "",
        f"Student: {STUDENT} ({ROLL_NUMBER})",
        "Achievement: First place, Smart India Hackathon 2026 (Software Edition)",
        f"Mentor: {FACULTY}",
    ],
    ("student_mentorship", "Project Report"): [
        "Project Report - Final Year Capstone", "",
        f"Student: {STUDENT} ({ROLL_NUMBER})",
        "Title: A Low-Bandwidth Telemetry Layer for Rural Health Centres",
        f"Guide: {FACULTY}",
    ],
    ("administration", "Appraisal"): [
        "Self Appraisal Summary 2026-27", "",
        f"Faculty: {FACULTY} | {DEPARTMENT}",
        "Sections: teaching, research, mentoring, service.",
    ],
    ("administration", "University Form"): [
        "University Form - Faculty Workload Declaration", "",
        f"Name: {FACULTY}", "Academic year: 2026-27", "Total contact hours per week: 16",
    ],
    ("administration", "Department Report"): [
        "Department Report - Information Technology, 2026-27", "",
        "Faculty strength: 24 | Publications: 39 | Funded projects: 6",
    ],
    ("other", "Needs Classification"): [
        "Untitled Scan", "",
        "A page with no recognisable academic heading, kept to prove that an",
        "unrecognised upload is filed for confirmation rather than guessed at.",
    ],
}


# Leaves the deterministic rules cannot reach, with the rule that shadows them.
# "Project Report" exists under both research and student_mentorship, but the
# single ("project report", student_mentorship, ...) rule fires first and wins,
# so a funded project's own report is filed under student mentorship. The demo
# document is still generated -- an LLM pass or a manual correction can move it
# -- and the mismatch is reported as known rather than as a failure.
KNOWN_UNREACHABLE: dict[tuple[str, str], tuple[str, str]] = {
    ("research", "Project Report"): ("student_mentorship", "Project Report"),
}


def slug(value: str) -> str:
    return value.replace(" ", "_")


def main() -> int:
    written: list[tuple[Path, str, str]] = []

    # 1. Smart Academic Repository -- one demo document per classifier leaf,
    #    foldered by category so the demo can walk the taxonomy on screen.
    for category, types in TAXONOMY.items():
        for document_type in types:
            body = LEAF_BODIES.get((category, document_type))
            if body is None:
                print(f"  ! no demo body defined for {category}/{document_type}")
                continue
            path = ROOT / "repository-samples" / category / f"demo1_{slug(document_type)}.pdf"
            write_pdf(path, body)
            written.append((path, category, document_type))

    # 2. CV Import -- a different professor, so the import produces new
    #    activities rather than duplicates of the ones already on file.
    cv_lines = [
        FACULTY, f"Professor, {DEPARTMENT}", COLLEGE, "",
        "ACADEMIC ACTIVITIES 2026-27",
        "Attended FDP on Applied Distributed Systems, IIT Madras, 2026",
        "Delivered an invited talk on Edge Telemetry at ACM Mumbai Chapter, 2026",
        "Published a paper titled 'Edge-Aware Scheduling for Real-Time IoT Telemetry', 2026",
        "Reviewer for the International Conference on Emerging Networks, 2026",
        "Supervised 4 final-year capstone teams, 2026",
        "Member, Academic Monitoring Committee, 2026-present",
        "Received the Vice-Chancellor's Teaching Excellence Award, 2026",
        "Principal Investigator, AICTE Research Promotion Scheme grant, 2026",
        "",
        "Enjoys long-distance cycling on weekends.",
    ]
    write_pdf(ROOT / "cv-import" / "demo1_cv.pdf", cv_lines)
    write_docx(ROOT / "cv-import" / "demo1_cv.docx", cv_lines)

    # 3. Any Form -- the "Label:" / value shape the feature detects.
    write_xlsx(
        ROOT / "any-form" / "demo1_appraisal_form.xlsx",
        [
            ["Faculty Annual Data Sheet 2026-27"],
            [],
            ["Faculty Name:", ""],
            ["Employee Code:", ""],
            ["Department:", ""],
            ["Email:", ""],
            ["Number of Publications:", ""],
            ["Number of FDPs:", ""],
            ["Committees:", ""],
        ],
    )

    # 4. Admin batch request -- a *table* header (no trailing colons), which is
    #    the shape detect_header_row looks for, unlike the Any Form sheet above.
    #    Column B is deliberately left blank: a header laid out like this used to
    #    have every answer written one column to the left of where it belonged,
    #    so keeping it in the demo set guards that fix.
    write_xlsx(
        ROOT / "admin-batch" / "demo1_department_sheet.xlsx",
        [
            ["Department Data Request 2026-27"],
            [],
            ["Faculty Name", None, "Employee Code", "Number of Publications", "Number of FDPs"],
            ["", None, "", "", ""],
            ["", None, "", "", ""],
        ],
    )

    # 5. Teaching Change Detector -- v2 adds a unit and a new lab, so the diff
    #    has something to report.
    write_pdf(ROOT / "teaching-change" / "demo1_course_v1" / "syllabus.pdf", [
        "IT402 Syllabus", "Unit 1: Time and Ordering", "Unit 2: Replication",
    ])
    write_pdf(ROOT / "teaching-change" / "demo1_course_v1" / "lab1.pdf", [
        "Lab 1: Vector clock implementation",
    ])
    write_pdf(ROOT / "teaching-change" / "demo1_course_v2" / "syllabus.pdf", [
        "IT402 Syllabus", "Unit 1: Time and Ordering", "Unit 2: Replication",
        "Unit 3: Consensus under partial synchrony",
    ])
    write_pdf(ROOT / "teaching-change" / "demo1_course_v2" / "lab1.pdf", [
        "Lab 1: Vector clock implementation",
    ])
    write_pdf(ROOT / "teaching-change" / "demo1_course_v2" / "lab2_new.pdf", [
        "Lab 2: Replicated key-value store deployment",
    ])

    # 6. Evidence Library -- one PDF and one photographed certificate.
    write_pdf(ROOT / "evidence-library" / "demo1_certificate.pdf", [
        "Certificate of Appreciation", f"Presented to {FACULTY}",
        "For the invited talk at ACM Mumbai Chapter", "18 August 2026",
    ])
    write_image(ROOT / "evidence-library" / "demo1_certificate.jpg", [
        "Certificate of Appreciation", FACULTY, "ACM Mumbai Chapter", "August 2026",
    ])

    # 7. Verify the repository documents actually classify where intended --
    #    keyword rules are first-match-wins, so a stray word in the body can
    #    silently reroute a document to another leaf.
    print(f"\nVerifying {len(written)} repository documents against the classifier:\n")
    failures = 0
    for path, category, document_type in written:
        text = f"{path.name} {pymupdf.open(path)[0].get_text()}"
        result = classify_deterministic(path.name, text)
        actual = (result.document_category, result.document_type)
        expected = KNOWN_UNREACHABLE.get((category, document_type), (category, document_type))
        known = (category, document_type) in KNOWN_UNREACHABLE
        if actual == expected:
            status = "known" if known else "ok  "
        else:
            status = "MISS"
            failures += 1
        detail = ""
        if status != "ok  ":
            detail = f"  -> filed as {actual[0]}/{actual[1]}"
        print(f"  {status} {category}/{document_type}{detail}")

    total = len(written) + 13
    print(f"\n{total} demo files written under {ROOT}")
    if failures:
        print(f"{failures} document(s) did not classify as intended.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
