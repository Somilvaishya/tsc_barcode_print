# Copyright (c) 2026, Somil and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt

class BarcodeGenerationTool(Document):
    def on_submit(self):
        # 1. Create a new Batch if mode is "New Pre-Batch"
        if self.mode == "New Pre-Batch":
            # Role validation: restrict to Stock Manager or System Manager
            user_roles = frappe.get_roles()
            if not ("Stock Manager" in user_roles or "System Manager" in user_roles):
                frappe.throw("You do not have the required role (Stock Manager or System Manager) to pre-generate Batch IDs.")

            if not self.batch_no:
                frappe.throw("Batch No is required in 'New Pre-Batch' mode.")
                
            if not frappe.db.exists("Batch", self.batch_no):
                batch = frappe.new_doc("Batch")
                batch.batch_id = self.batch_no
                batch.item = self.item_code
                batch.custom_pre_batch_status = "Pre-Generated"
                if self.manufacturing_date:
                    batch.manufacturing_date = self.manufacturing_date
                if self.expiry_date:
                    batch.expiry_date = self.expiry_date
                
                # Insert the batch document
                batch.insert(ignore_permissions=True)
                frappe.msgprint(f"Standalone Batch {self.batch_no} created successfully.")
            else:
                frappe.msgprint(f"Batch {self.batch_no} already exists.")
        
        # 2. Existing Batch validation
        elif self.mode == "Existing Batch":
            if not self.existing_batch:
                frappe.throw("Existing Batch selection is required.")
                
            # Verify batch belongs to the selected item
            batch_item = frappe.db.get_value("Batch", self.existing_batch, "item")
            if batch_item != self.item_code:
                frappe.throw(f"Selected Batch {self.existing_batch} does not belong to Item {self.item_code}.")
