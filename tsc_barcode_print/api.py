import frappe
import json
import os
import base64
from frappe.utils import nowdate, flt

@frappe.whitelist()
def render_barcode_template(template_name, item_code, batch_id, mfg_date=None, label_qty=1, no_of_copies=1):
    template = frappe.get_doc("Barcode Template", template_name)
    
    item = frappe.get_doc("Item", item_code)
    
    context = {
        "item_code": item_code,
        "item_name": item.item_name,
        "batch_id": batch_id,
        "manufacturing_date": mfg_date or nowdate(),
        "qty": flt(label_qty),
        "no_of_copies": int(no_of_copies)
    }
    
    rendered_tspl = frappe.render_template(template.raw_tspl, context)
    
    # We must prepend the size, gap, direction and clear buffer commands in the correct sequence
    header = f"SIZE {template.label_width} mm, {template.label_height} mm\nGAP 3 mm, 0 mm\nDIRECTION 1\nCLS\n"
    
    # And append the print command
    footer = f"\nPRINT 1,{int(no_of_copies)}\n"
    
    full_tspl = header + rendered_tspl + footer
    
    # Return as an array of commands for QZ Tray to send natively
    return {
        "tspl": [full_tspl]
    }

@frappe.whitelist()
def get_printer_settings():
    # Deprecated fallback for compatibility
    return {
        "printer_name": "",
        "qz_host": "localhost",
        "qz_port": 8181
    }

@frappe.whitelist()
def get_default_printer_profile():
    return None

# ─────────────────────────────────────────────────────────────────────────────
# QZ Tray Certificate Authentication
# Eliminates the "Action Required / Untrusted Website" popup for all users.
# The private key signs every QZ connection request server-side.
# ─────────────────────────────────────────────────────────────────────────────

@frappe.whitelist(allow_guest=False)
def get_qz_certificate():
    """Return the public certificate so QZ Tray can verify our signatures."""
    cert_path = os.path.join(
        frappe.get_app_path('tsc_barcode_print'), 'qz_cert.pem'
    )
    if not os.path.exists(cert_path):
        frappe.throw('QZ Tray certificate not found. Run setup first.')
    with open(cert_path, 'r') as f:
        return f.read()

@frappe.whitelist(allow_guest=False)
def sign_qz_message(message):
    """Sign a QZ Tray authentication challenge with our private key."""
    try:
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding
    except ImportError:
        frappe.throw('cryptography package not available. Run: pip install cryptography')

    key_path = os.path.join(
        frappe.get_app_path('tsc_barcode_print'), 'qz_private.pem'
    )
    if not os.path.exists(key_path):
        frappe.throw('QZ Tray private key not found.')

    with open(key_path, 'rb') as f:
        private_key = serialization.load_pem_private_key(f.read(), password=None)

    signature = private_key.sign(
        message.encode('utf-8'),
        padding.PKCS1v15(),
        hashes.SHA512()
    )
    return base64.b64encode(signature).decode('utf-8')

@frappe.whitelist()
def get_items_for_barcode_print(doctype, docname):
    doc = frappe.get_doc(doctype, docname)
    items_to_print = []
    
    for d in doc.get("items") or []:
        # 1. If batch_no is directly set in the row
        if d.get("batch_no"):
            mfg_date = frappe.db.get_value("Batch", d.batch_no, "manufacturing_date")
            items_to_print.append({
                "item_code": d.item_code,
                "batch_no": d.batch_no,
                "mfg_date": mfg_date or "",
                "label_qty": flt(d.qty),
                "no_of_copies": 1
            })
        
        # 2. If it has a serial_and_batch_bundle
        elif d.get("serial_and_batch_bundle"):
            entries = frappe.get_all(
                "Serial and Batch Entry",
                filters={"parent": d.serial_and_batch_bundle},
                fields=["batch_no", "qty", "serial_no"]
            )
            
            # Group entries by batch_no / serial_no to sum/collect
            batch_groups = {}
            for entry in entries:
                b_no = entry.get("batch_no") or entry.get("serial_no") or ""
                qty = flt(entry.get("qty") or 1.0)
                if b_no:
                    batch_groups[b_no] = batch_groups.get(b_no, 0.0) + qty
                else:
                    batch_groups[""] = batch_groups.get("", 0.0) + qty
            
            for b_no, qty in batch_groups.items():
                mfg_date = ""
                if b_no and frappe.db.exists("Batch", b_no):
                    mfg_date = frappe.db.get_value("Batch", b_no, "manufacturing_date")
                items_to_print.append({
                    "item_code": d.item_code,
                    "batch_no": b_no,
                    "mfg_date": mfg_date or "",
                    "label_qty": qty,
                    "no_of_copies": 1
                })
        
        # 3. Fallback for items with no batch/serial bundle
        else:
            items_to_print.append({
                "item_code": d.item_code,
                "batch_no": "",
                "mfg_date": "",
                "label_qty": flt(d.qty),
                "no_of_copies": 1
            })
            
    return items_to_print

@frappe.whitelist()
def log_barcode_print(template, printer_profile, item_code, batch_no, label_qty, no_of_copies, source_doctype=None, source_docname=None):
    log = frappe.new_doc("Barcode Print Log")
    log.print_datetime = frappe.utils.now_datetime()
    log.printed_by = frappe.session.user
    log.template = template
    log.printer_profile = printer_profile
    log.item_code = item_code
    log.batch_no = batch_no
    log.label_qty = flt(label_qty)
    log.no_of_copies = int(no_of_copies)
    log.source_doctype = source_doctype
    log.source_docname = source_docname
    log.insert(ignore_permissions=True)
    frappe.db.commit()
    return log.name

def setup_custom_fields():
    from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
    create_custom_fields({
        "Batch": [
            {
                "fieldname": "custom_pre_batch_status",
                "label": "Pre-Batch Status",
                "fieldtype": "Select",
                "options": "\nPre-Generated\nConsumed",
                "default": "",
                "insert_after": "expiry_date",
                "read_only": 1
            }
        ]
    })
    
    # Auto-initialize Workspace, Number Cards, and Dashboard Charts in the DB
    try:
        create_number_cards()
        create_dashboard_charts()
        create_workspace()
    except Exception as e:
        frappe.log_error(f"Failed to auto-create workspace elements: {str(e)}", "TSC Barcode Setup Error")

def create_number_cards():
    cards = [
        {
            "name": "Labels Printed Today",
            "label": "Labels Printed Today",
            "document_type": "Barcode Print Log",
            "function": "Sum",
            "aggregate_function_based_on": "no_of_copies",
            "filters_json": '[["Barcode Print Log","print_datetime","Timespan","today",false]]'
        },
        {
            "name": "Total Prints This Month",
            "label": "Total Prints This Month",
            "document_type": "Barcode Print Log",
            "function": "Sum",
            "aggregate_function_based_on": "no_of_copies",
            "filters_json": '[["Barcode Print Log","print_datetime","Timespan","this month",false]]'
        },
        {
            "name": "Pre-Generated Batches Pending",
            "label": "Pre-Generated Batches Pending",
            "document_type": "Batch",
            "function": "Count",
            "filters_json": '[["Batch","custom_pre_batch_status","=","Pre-Generated",false]]'
        }
    ]
    
    for c in cards:
        if not frappe.db.exists("Number Card", c["name"]):
            card = frappe.new_doc("Number Card")
            card.update(c)
            card.is_standard = 1
            card.module = "TSC Barcode Print"
            card.insert(ignore_permissions=True)
        else:
            card = frappe.get_doc("Number Card", c["name"])
            card.update(c)
            card.save(ignore_permissions=True)

def create_dashboard_charts():
    charts = [
        {
            "chart_name": "Prints per Day",
            "chart_type": "Sum",
            "document_type": "Barcode Print Log",
            "based_on": "print_datetime",
            "value_based_on": "no_of_copies",
            "timespan": "Last Month",
            "time_interval": "Daily",
            "type": "Bar",
            "is_public": 1,
            "timeseries": 1,
            "filters_json": "[]"
        }
    ]
    
    for ch in charts:
        if not frappe.db.exists("Dashboard Chart", ch["chart_name"]):
            chart = frappe.new_doc("Dashboard Chart")
            chart.update(ch)
            chart.is_standard = 1
            chart.module = "TSC Barcode Print"
            chart.insert(ignore_permissions=True)
        else:
            chart = frappe.get_doc("Dashboard Chart", ch["chart_name"])
            chart.update(ch)
            chart.save(ignore_permissions=True)

def create_workspace():
    ws_name = "TSC Barcode Print"
    ws_content = json.dumps([
        {"id":"hdr-onboarding","type":"header","data":{"text":"TSC Barcode Printing Hub","col":12,"level":3}},
        {"id":"txt-onboarding","type":"paragraph","data":{"text":"Welcome to the TSC Barcode Print module. Manage your templates, pre-batch code generations, and audit printing logs here.","col":12}},
        {"id":"sp-0","type":"spacer","data":{"col":12}},
        {"id":"hdr-shortcuts","type":"header","data":{"text":"Quick Actions","col":12,"level":5}},
        {"id":"sc-gen","type":"shortcut","data":{"shortcut_name":"Barcode Generation Tool","col":3}},
        {"id":"sc-template","type":"shortcut","data":{"shortcut_name":"Barcode Template","col":3}},
        {"id":"sc-log","type":"shortcut","data":{"shortcut_name":"Barcode Print Log","col":3}},
        {"id":"sc-rep","type":"shortcut","data":{"shortcut_name":"Barcode Print Summary","col":3}},
        {"id":"sp-1","type":"spacer","data":{"col":12}},
        {"id":"hdr-cards","type":"header","data":{"text":"Performance Metrics","col":12,"level":5}},
        {"id":"nc-today","type":"number_card","data":{"number_card_name":"Labels Printed Today","col":4}},
        {"id":"nc-month","type":"number_card","data":{"number_card_name":"Total Prints This Month","col":4}},
        {"id":"nc-pre","type":"number_card","data":{"number_card_name":"Pre-Generated Batches Pending","col":4}},
        {"id":"sp-2","type":"spacer","data":{"col":12}},
        {"id":"hdr-chart","type":"header","data":{"text":"Print Logs Analysis","col":12,"level":5}},
        {"id":"ch-history","type":"chart","data":{"chart_name":"Prints per Day","col":12}}
    ])
    
    if frappe.db.exists("Workspace", ws_name):
        ws = frappe.get_doc("Workspace", ws_name)
        ws.set("shortcuts", [])
        ws.set("number_cards", [])
        ws.set("charts", [])
    else:
        ws = frappe.new_doc("Workspace")
        ws.name = ws_name
        ws.label = ws_name
        ws.title = ws_name
        
    ws.icon = "printer"
    ws.indicator_color = "green"
    ws.module = "TSC Barcode Print"
    ws.category = "Modules"
    ws.public = 1
    ws.is_standard = 1
    ws.content = ws_content
    
    # Add shortcuts
    ws.append("shortcuts", {"type": "DocType", "link_to": "Barcode Generation Tool", "label": "Barcode Generation Tool", "icon": "add"})
    ws.append("shortcuts", {"type": "DocType", "link_to": "Barcode Template", "label": "Barcode Template", "icon": "file-text"})
    ws.append("shortcuts", {"type": "DocType", "link_to": "Barcode Print Log", "label": "Barcode Print Log", "icon": "history"})
    ws.append("shortcuts", {"type": "Report", "link_to": "Barcode Print Summary", "label": "Barcode Print Summary", "icon": "chart-bar", "report_ref_doctype": "Barcode Print Log"})
    
    # Add number cards
    ws.append("number_cards", {"number_card_name": "Labels Printed Today", "label": "Labels Printed Today"})
    ws.append("number_cards", {"number_card_name": "Total Prints This Month", "label": "Total Prints This Month"})
    ws.append("number_cards", {"number_card_name": "Pre-Generated Batches Pending", "label": "Pre-Generated Batches Pending"})
    
    # Add charts
    ws.append("charts", {"chart_name": "Prints per Day", "label": "Prints per Day"})
    
    ws.save(ignore_permissions=True)
    frappe.db.commit()

def on_transaction_submit(doc, method):
    # Extract all batch numbers from items or serial and batch bundles
    batches_used = set()
    for d in doc.get("items") or []:
        if d.get("batch_no"):
            batches_used.add(d.batch_no)
        if d.get("serial_and_batch_bundle"):
            entries = frappe.get_all(
                "Serial and Batch Entry",
                filters={"parent": d.serial_and_batch_bundle},
                fields=["batch_no"]
            )
            for entry in entries:
                if entry.get("batch_no"):
                    batches_used.add(entry.get("batch_no"))
    
    # Update pre-generated batches to "Consumed"
    for batch_no in batches_used:
        if frappe.db.exists("Batch", batch_no):
            status = frappe.db.get_value("Batch", batch_no, "custom_pre_batch_status")
            if status == "Pre-Generated":
                frappe.db.set_value("Batch", batch_no, "custom_pre_batch_status", "Consumed")

