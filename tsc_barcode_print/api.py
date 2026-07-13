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
    
    # We must also prepend the size and clear buffer commands
    header = f"SIZE {template.label_width} mm, {template.label_height} mm\nCLS\n"
    
    # And append the print command
    footer = f"\nPRINT 1,{int(no_of_copies)}\n"
    
    full_tspl = header + rendered_tspl + footer
    
    # Return as an array of commands for QZ Tray to send natively
    return {
        "tspl": [full_tspl]
    }

@frappe.whitelist()
def get_printer_settings():
    settings = frappe.get_single("Barcode Settings")
    return {
        "printer_name": settings.printer_name,
        "qz_host": settings.qz_host,
        "qz_port": settings.qz_port
    }
