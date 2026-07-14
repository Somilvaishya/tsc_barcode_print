import frappe
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
    profile = get_default_printer_profile()
    if profile:
        return {
            "printer_name": profile.printer_name,
            "qz_host": "localhost",
            "qz_port": 8181
        }
    return {
        "printer_name": "",
        "qz_host": "localhost",
        "qz_port": 8181
    }

@frappe.whitelist()
def get_default_printer_profile():
    profiles = frappe.get_all("Printer Profile", filters={"is_active": 1}, order_by="creation desc", limit=1)
    if profiles:
        return frappe.get_doc("Printer Profile", profiles[0].name)
    return None

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
