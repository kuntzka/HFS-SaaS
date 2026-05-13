ALTER TABLE {SCHEMA}.route
    ADD employee_id INT NULL
        REFERENCES {SCHEMA}.employee(employee_id);
