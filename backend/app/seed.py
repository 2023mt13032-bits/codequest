"""Creates the admin user (from env) and one sample assessment covering every
question type, so the whole pipeline can be verified end-to-end immediately."""
import os

from .database import SessionLocal
from . import models
from .auth import hash_password


def ensure_seed():
    db = SessionLocal()
    try:
        admin_user = os.getenv("ADMIN_USERNAME", "admin")
        admin_pass = os.getenv("ADMIN_PASSWORD", "admin123")
        if not db.query(models.User).filter_by(username=admin_user).first():
            db.add(models.User(username=admin_user, password_hash=hash_password(admin_pass),
                               role="admin", full_name="Administrator"))
            db.commit()

        # Seed the demo content only once ever. A marker user is more reliable
        # than checking for assessments (the admin may delete the sample one).
        if db.query(models.User).filter_by(username="demo_student").first():
            return  # already seeded at some point — never re-seed
        if db.query(models.Assessment).first() or db.query(models.Question).first():
            return  # admin already has real content — don't add samples

        demo = models.User(username="demo_student", password_hash=hash_password("demo123"),
                           role="student", full_name="Demo Student")
        db.add(demo)

        q1 = models.Question(
            qtype="python", title="Sum of Two Numbers", marks=10,
            statement=("Read two integers from input (one per line) and print their sum.\n\n"
                       "**Example**\n```\nInput:\n2\n3\nOutput:\n5\n```"),
            config={
                "starter_code": "a = int(input())\nb = int(input())\n# print their sum\n",
                "solution": "a = int(input())\nb = int(input())\nprint(a + b)\n",
                "time_limit": 5,
                "test_cases": [
                    {"input": "2\n3\n", "expected": "5", "marks": 3, "visible": True},
                    {"input": "10\n-4\n", "expected": "6", "marks": 3, "visible": True},
                    {"input": "1000000\n2000000\n", "expected": "3000000", "marks": 4, "visible": False},
                ],
            })
        q2 = models.Question(
            qtype="sql", title="High-Salary Employees", marks=10,
            statement=("Table `employees(id, name, salary)`.\n\n"
                       "Write a query returning **name, salary** of employees with "
                       "salary above 50000, ordered by salary descending."),
            config={
                "correct_sql": "SELECT name, salary FROM employees WHERE salary > 50000 ORDER BY salary DESC;",
                "order_sensitive": True,
                "datasets": [{
                    "seed_sql": ("CREATE TABLE employees(id INT, name TEXT, salary INT);"
                                 "INSERT INTO employees VALUES (1,'Asha',60000),(2,'Ravi',45000),"
                                 "(3,'Meena',75000),(4,'Kiran',52000);"),
                    "marks": 1, "visible": True,
                }],
            })
        q3 = models.Question(
            qtype="mcq_single", title="Python Lists", marks=2,
            statement="What does `len([1, [2, 3], 4])` return?",
            config={"options": ["2", "3", "4", "Error"], "correct": 1})
        q4 = models.Question(
            qtype="mcq_multi", title="Immutable Types", marks=4,
            statement="Which of these Python types are **immutable**? (select all that apply)",
            config={"options": ["list", "tuple", "dict", "str"], "correct": [1, 3], "partial": True})
        q5 = models.Question(
            qtype="fill_blank", title="SQL Keywords", marks=4,
            statement=("Fill in the blanks:\n\nTo remove duplicate rows we use `SELECT {{blank}} ...`, "
                       "and to sort results we use `ORDER {{blank}} column`."),
            config={"blanks": [{"answers": ["DISTINCT"], "case_sensitive": False},
                               {"answers": ["BY"], "case_sensitive": False}],
                    "all_or_nothing": False})
        q6 = models.Question(
            qtype="descriptive", title="Explain Indexing", marks=5,
            statement="In 3-5 sentences, explain what a database index is and one trade-off of using it.",
            config={})
        db.add_all([q1, q2, q3, q4, q5, q6])
        db.commit()

        a = models.Assessment(title="Sample Assessment (all question types)",
                              description="Use this to verify the platform end-to-end. Safe to delete.",
                              published=True, show_results=True, assign_all=True,
                              duration_minutes=None)
        db.add(a); db.commit()
        for i, q in enumerate([q1, q2, q3, q4, q5, q6]):
            db.add(models.AssessmentQuestion(assessment_id=a.id, question_id=q.id, position=i))
        db.commit()
    finally:
        db.close()