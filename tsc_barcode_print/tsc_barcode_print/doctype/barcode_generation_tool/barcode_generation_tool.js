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
        // Render form preview
        update_form_preview(frm);

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

                let execute_print = function() {
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
                };

                if (frm.doc.no_of_copies > 0 && frm.doc.no_of_copies > frm.doc.label_qty * 2) {
                    frappe.confirm(
                        __("Warning: You are printing significantly more copies ({0}) than the label quantity ({1}). Are you sure you want to proceed?", [frm.doc.no_of_copies, frm.doc.label_qty]),
                        function() {
                            execute_print();
                        },
                        function() {
                            // User canceled
                        }
                    );
                } else {
                    execute_print();
                }
            }, __('Actions'));
        }
    },
    item_code: function(frm) {
        frm.set_value('existing_batch', '');
        update_form_preview(frm);
    },
    mode: function(frm) {
        update_form_preview(frm);
    },
    batch_no: function(frm) {
        update_form_preview(frm);
    },
    existing_batch: function(frm) {
        update_form_preview(frm);
    },
    manufacturing_date: function(frm) {
        update_form_preview(frm);
    },
    label_qty: function(frm) {
        update_form_preview(frm);
    },
    barcode_template: function(frm) {
        update_form_preview(frm);
    }
});

function update_form_preview(frm) {
    if (!frm.doc.barcode_template) {
        frm.fields_dict.preview_html.$wrapper.html('');
        return;
    }

    frappe.db.get_doc("Barcode Template", frm.doc.barcode_template).then(template_doc => {
        if (!template_doc) return;

        let container = frm.fields_dict.preview_html.$wrapper.find('.tspl-preview-container')[0];
        if (!container) {
            frm.fields_dict.preview_html.$wrapper.html(`
                <div style="font-weight: bold; margin-bottom: 8px; font-size: 14px; color: #555;">Live Barcode Preview:</div>
                <div style="padding: 15px; background-color: #f7f7f7; border-radius: 8px; border: 1px dashed #ccc; display: flex; justify-content: center; align-items: center; min-height: 200px;">
                    <div class="tspl-preview-container"></div>
                </div>
            `);
            container = frm.fields_dict.preview_html.$wrapper.find('.tspl-preview-container')[0];
        }

        let batch = frm.doc.mode === "New Pre-Batch" ? frm.doc.batch_no : frm.doc.existing_batch;
        let context = {
            item_code: frm.doc.item_code || "",
            item_name: frm.doc.item_name || frm.doc.item_code || "",
            batch_id: batch || "",
            manufacturing_date: frm.doc.manufacturing_date || "",
            qty: frm.doc.label_qty || 1.0,
            no_of_copies: frm.doc.no_of_copies || 1
        };

        if (window.TSCPrinter && typeof window.TSCPrinter.renderPreview === 'function') {
            window.TSCPrinter.renderPreview(container, template_doc, context);
        }
    });
}
