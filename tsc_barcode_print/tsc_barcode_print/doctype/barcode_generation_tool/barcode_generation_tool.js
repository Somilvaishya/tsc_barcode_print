frappe.ui.form.on('Barcode Generation Tool', {
    refresh: function(frm) {
        if (frm.doc.docstatus === 1) { // Only if submitted
            frm.add_custom_button(__('Print Barcode'), function() {
                if (!frm.doc.barcode_template) {
                    frappe.msgprint("Please select a Barcode Template");
                    return;
                }
                
                frm.disable_save();
                window.TSCPrinter.printTSPL(
                    frm.doc.barcode_template,
                    frm.doc.item_code,
                    frm.doc.batch_id,
                    frm.doc.manufacturing_date,
                    frm.doc.label_qty,
                    frm.doc.no_of_copies
                ).then(() => {
                    frm.enable_save();
                }).catch(() => {
                    frm.enable_save();
                });
            }, __('Actions'));
        }
    }
});
