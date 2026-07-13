# Copyright (c) 2026, Somil and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import today

class BarcodeGenerationTool(Document):
    def on_submit(self):
        # Create a new Batch if it doesn't exist
        if not frappe.db.exists("Batch", self.batch_id):
            batch = frappe.new_doc("Batch")
            batch.batch_id = self.batch_id
            batch.item = self.item_code
            if self.manufacturing_date:
                batch.manufacturing_date = self.manufacturing_date
            
            # Since ERPNext 14/15, batches might require an item to have has_batch_no = 1
            # We assume the user has configured the item properly.
            batch.insert(ignore_permissions=True)
            frappe.msgprint(f"Batch {self.batch_id} created successfully.")
