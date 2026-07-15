# Copyright (c) 2026, Somil and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt

def execute(filters=None):
    columns = get_columns()
    data = get_data(filters)
    return columns, data

def get_columns():
    return [
        {
            "fieldname": "date",
            "label": _("Date"),
            "fieldtype": "Date",
            "width": 120
        },
        {
            "fieldname": "printer_profile",
            "label": _("Printer Profile"),
            "fieldtype": "Link",
            "options": "Printer Profile",
            "width": 150
        },
        {
            "fieldname": "item_code",
            "label": _("Item Code"),
            "fieldtype": "Link",
            "options": "Item",
            "width": 120
        },
        {
            "fieldname": "printed_by",
            "label": _("Printed By"),
            "fieldtype": "Link",
            "options": "User",
            "width": 150
        },
        {
            "fieldname": "total_prints",
            "label": _("Total Copies Printed"),
            "fieldtype": "Int",
            "width": 150
        },
        {
            "fieldname": "total_qty",
            "label": _("Total Label Qty"),
            "fieldtype": "Float",
            "width": 120
        }
    ]

def get_data(filters):
    conditions = []
    values = {}

    if filters.get("from_date"):
        conditions.append("print_datetime >= %(from_date)s")
        values["from_date"] = filters.get("from_date")
    if filters.get("to_date"):
        conditions.append("print_datetime <= %(to_date)s")
        values["to_date"] = f"{filters.get('to_date')} 23:59:59"
    if filters.get("printer_profile"):
        conditions.append("printer_profile = %(printer_profile)s")
        values["printer_profile"] = filters.get("printer_profile")

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    query = f"""
        SELECT
            DATE(print_datetime) AS date,
            printer_profile,
            item_code,
            printed_by,
            SUM(no_of_copies) AS total_prints,
            SUM(label_qty) AS total_qty
        FROM
            `tabBarcode Print Log`
        {where_clause}
        GROUP BY
            DATE(print_datetime), printer_profile, item_code, printed_by
        ORDER BY
            date DESC
    """
    return frappe.db.sql(query, values, as_dict=True)
