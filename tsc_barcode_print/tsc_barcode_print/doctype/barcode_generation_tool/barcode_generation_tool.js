frappe.ui.form.on('Barcode Generation Tool', {
    onload: function(frm) {
        // Set query filter for existing_batch to only show batches of the selected item
        frm.set_query('existing_batch', function() {
            return {
                filters: {
                    item: frm.doc.item_code
                }
            };
        });
    },
    refresh: function(frm) {
        if (frm.doc.docstatus === 1) { // Only if submitted
            frm.add_custom_button(__('Print Barcode'), function() {
                if (!frm.doc.barcode_template) {
                    frappe.msgprint(__("Please select a Barcode Template"));
                    return;
                }
                if (!frm.doc.target_printer) {
                    frappe.msgprint(__("Please select a Target Printer Profile"));
                    return;
                }
                
                let batch = frm.doc.mode === "New Pre-Batch" ? frm.doc.batch_no : frm.doc.existing_batch;
                if (!batch) {
                    frappe.msgprint(__("No Batch resolved for printing."));
                    return;
                }

                frm.disable_save();
                window.TSCPrinter.printTSPL(
                    frm.doc.barcode_template,
                    frm.doc.item_code,
                    batch,
                    frm.doc.manufacturing_date,
                    frm.doc.label_qty,
                    frm.doc.no_of_copies,
                    frm.doc.target_printer
                ).then(() => {
                    frm.enable_save();
                }).catch(() => {
                    frm.enable_save();
                });
            }, __('Actions'));
        }
    },
    item_code: function(frm) {
        // Clear batch selections if item code changes
        frm.set_value('existing_batch', '');
    }
});
