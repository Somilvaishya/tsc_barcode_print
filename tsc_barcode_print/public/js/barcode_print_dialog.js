// Generic script attached to Purchase Receipt and Stock Entry via hooks.py

function inject_barcode_print_button(frm) {
    // Only show if document is submitted (or maybe even draft? Let's say any status except cancelled)
    if (frm.doc.docstatus === 2) return;

    frm.add_custom_button(__('Print Barcodes'), function() {
        open_barcode_print_dialog(frm);
    }, __('Actions'));
}

function open_barcode_print_dialog(frm) {
    if (!frm.doc.items || frm.doc.items.length === 0) {
        frappe.msgprint(__('No items found in this document.'));
        return;
    }

    // Fetch available templates
    frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Barcode Template",
            fields: ["name"],
            limit_page_length: 0
        },
        callback: function(r) {
            let templates = (r.message || []).map(d => d.name);
            if (templates.length === 0) {
                frappe.msgprint(__('Please create a Barcode Template first.'));
                return;
            }

            // Prepare items for the dialog
            let dialog_items = frm.doc.items.map(d => {
                return {
                    item_code: d.item_code,
                    batch_no: d.batch_no || '',
                    mfg_date: '', // Might not be in the row depending on setup
                    label_qty: d.qty,
                    no_of_copies: 1
                };
            });

            let d = new frappe.ui.Dialog({
                title: 'Print Barcodes',
                fields: [
                    {
                        label: 'Barcode Template',
                        fieldname: 'template',
                        fieldtype: 'Select',
                        options: templates,
                        reqd: 1
                    },
                    {
                        label: 'Items to Print',
                        fieldname: 'items',
                        fieldtype: 'Table',
                        reqd: 1,
                        cannot_add_rows: true,
                        in_place_edit: true,
                        data: dialog_items,
                        fields: [
                            { fieldname: 'item_code', fieldtype: 'Link', options: 'Item', in_list_view: 1, label: 'Item Code', read_only: 1 },
                            { fieldname: 'batch_no', fieldtype: 'Data', in_list_view: 1, label: 'Batch No' },
                            { fieldname: 'mfg_date', fieldtype: 'Date', in_list_view: 1, label: 'Mfg Date' },
                            { fieldname: 'label_qty', fieldtype: 'Float', in_list_view: 1, label: 'Label Qty (Value)' },
                            { fieldname: 'no_of_copies', fieldtype: 'Int', in_list_view: 1, label: 'No. of Copies' }
                        ]
                    }
                ],
                size: 'extra-large',
                primary_action_label: 'Print via QZ Tray',
                primary_action: function(values) {
                    let items = values.items;
                    if (!items || items.length === 0) {
                        frappe.msgprint("No items to print.");
                        return;
                    }

                    d.get_primary_btn().prop('disabled', true);
                    
                    // Recursive function to print sequentially
                    function print_row(index) {
                        if (index >= items.length) {
                            d.hide();
                            frappe.msgprint({title: "Success", message: "All labels sent to printer.", indicator: "green"});
                            return;
                        }

                        let row = items[index];
                        if (row.no_of_copies > 0 && row.item_code) {
                            window.TSCPrinter.printTSPL(
                                values.template,
                                row.item_code,
                                row.batch_no,
                                row.mfg_date,
                                row.label_qty,
                                row.no_of_copies
                            ).then(() => {
                                print_row(index + 1);
                            }).catch((err) => {
                                d.get_primary_btn().prop('disabled', false);
                            });
                        } else {
                            // Skip row
                            print_row(index + 1);
                        }
                    }

                    // Start printing
                    print_row(0);
                }
            });

            d.show();
        }
    });
}

// Bind to both doctypes
frappe.ui.form.on('Purchase Receipt', {
    refresh: function(frm) {
        inject_barcode_print_button(frm);
    }
});

frappe.ui.form.on('Stock Entry', {
    refresh: function(frm) {
        inject_barcode_print_button(frm);
    }
});
