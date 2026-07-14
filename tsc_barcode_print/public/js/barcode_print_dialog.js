// Generic script attached to Purchase Receipt and Stock Entry via hooks.py

function inject_barcode_print_button(frm) {
    // Only show if document is submitted
    if (frm.doc.docstatus === 2) return;

    frm.add_custom_button(__('Print Barcodes'), function() {
        open_barcode_print_dialog(frm);
    }, __('Actions'));
}

function load_js_barcode(callback) {
    if (window.JsBarcode) {
        callback();
        return;
    }
    let script = document.createElement('script');
    script.src = "https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js";
    script.onload = callback;
    document.head.appendChild(script);
}

function open_barcode_print_dialog(frm) {
    if (!frm.doc.items || frm.doc.items.length === 0) {
        frappe.msgprint(__('No items found in this document.'));
        return;
    }

    // 1. Fetch available templates
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

            // 2. Fetch active printer profiles
            frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Printer Profile",
                    filters: { is_active: 1 },
                    fields: ["name"],
                    limit_page_length: 0
                },
                callback: function(p_res) {
                    let printers = (p_res.message || []).map(d => d.name);
                    if (printers.length === 0) {
                        frappe.msgprint(__('Please configure an active Printer Profile first.'));
                        return;
                    }

                    // 3. Fetch items (resolved with bundles) from server
                    frappe.call({
                        method: "tsc_barcode_print.api.get_items_for_barcode_print",
                        args: {
                            doctype: frm.doc.doctype,
                            docname: frm.doc.name
                        },
                        callback: function(res_items) {
                            let dialog_items = res_items.message || [];
                            if (dialog_items.length === 0) {
                                frappe.msgprint(__('No printable items resolved.'));
                                return;
                            }

                            // 4. Get the first template document detail
                            frappe.db.get_doc("Barcode Template", templates[0]).then(template_doc => {
                                // 5. Load JsBarcode and create dialog
                                load_js_barcode(function() {
                                    create_dialog(frm, templates, printers, template_doc, dialog_items);
                                });
                            });
                        }
                    });
                }
            });
        }
    });
}

function create_dialog(frm, templates, printers, initial_template, dialog_items) {
    let d = new frappe.ui.Dialog({
        title: 'Print Barcodes',
        fields: [
            {
                fieldname: 'template',
                label: 'Barcode Template',
                fieldtype: 'Select',
                options: templates,
                default: initial_template.name,
                reqd: 1,
                onchange: function() {
                    let val = d.get_value('template');
                    if (val) {
                        frappe.db.get_doc('Barcode Template', val).then(template_doc => {
                            d.template_doc = template_doc;
                            update_preview();
                        });
                    }
                }
            },
            {
                fieldname: 'printer_profile',
                label: 'Printer Profile',
                fieldtype: 'Select',
                options: printers,
                default: printers[0],
                reqd: 1
            },
            {
                fieldname: 'layout_section',
                fieldtype: 'Section Break',
                columns: 2
            },
            {
                fieldname: 'items',
                label: 'Items to Print',
                fieldtype: 'Table',
                reqd: 1,
                cannot_add_rows: true,
                in_place_edit: true,
                data: dialog_items,
                fields: [
                    { fieldname: 'item_code', fieldtype: 'Link', options: 'Item', in_list_view: 1, label: 'Item Code', read_only: 1 },
                    { fieldname: 'batch_no', fieldtype: 'Data', in_list_view: 1, label: 'Batch No' },
                    { fieldname: 'mfg_date', fieldtype: 'Date', in_list_view: 1, label: 'Mfg Date' },
                    { fieldname: 'label_qty', fieldtype: 'Float', in_list_view: 1, label: 'Label Qty' },
                    { fieldname: 'no_of_copies', fieldtype: 'Int', in_list_view: 1, label: 'No. of Copies' }
                ]
            },
            {
                fieldtype: 'Column Break'
            },
            {
                fieldname: 'preview_html',
                fieldtype: 'HTML',
                label: 'Barcode Preview'
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
                        row.no_of_copies,
                        values.printer_profile
                    ).then(() => {
                        print_row(index + 1);
                    }).catch((err) => {
                        d.get_primary_btn().prop('disabled', false);
                    });
                } else {
                    print_row(index + 1);
                }
            }

            print_row(0);
        }
    });

    d.template_doc = initial_template;

    // Helper to get active selected row
    function get_active_row() {
        let grid = d.fields_dict.items.grid;
        let active_name = grid.wrapper.find('.grid-row-active').attr('data-name');
        if (active_name) {
            return grid.get_docrow(active_name);
        }
        // Fallback to first row
        if (grid.grid_rows && grid.grid_rows.length > 0) {
            return grid.grid_rows[0].doc;
        }
        return null;
    }

    // Helper to update preview
    function update_preview(row) {
        if (!row) {
            row = get_active_row();
        }
        if (!row || !d.template_doc) return;

        let $preview_wrapper = d.fields_dict.preview_html.$wrapper;
        let container = $preview_wrapper.find('.tspl-preview-container')[0];
        if (!container) {
            $preview_wrapper.html(`
                <div style="font-weight: bold; margin-bottom: 8px; font-size: 14px; color: #555;">Live Barcode Preview:</div>
                <div style="padding: 15px; background-color: #f7f7f7; border-radius: 8px; border: 1px dashed #ccc; display: flex; justify-content: center; align-items: center; min-height: 250px;">
                    <div class="tspl-preview-container"></div>
                </div>
            `);
            container = $preview_wrapper.find('.tspl-preview-container')[0];
        }

        let context = {
            item_code: row.item_code || "",
            item_name: row.item_name || row.item_code || "",
            batch_id: row.batch_no || "",
            manufacturing_date: row.mfg_date || "",
            qty: row.label_qty || 1.0,
            no_of_copies: row.no_of_copies || 1
        };

        render_tspl_preview(container, d.template_doc, context);
    }

    // Bind row click to update preview
    d.fields_dict.items.grid.wrapper.on('click', '.grid-row', function() {
        let docname = $(this).attr('data-name');
        let row = d.fields_dict.items.grid.get_docrow(docname);
        if (row) {
            update_preview(row);
        }
    });

    // Bind inputs changes to update preview
    d.fields_dict.items.grid.wrapper.on('change', 'input', function() {
        let docname = $(this).closest('.grid-row').attr('data-name');
        if (docname) {
            // Wait slightly for model to update
            setTimeout(() => {
                let row = d.fields_dict.items.grid.get_docrow(docname);
                if (row) {
                    update_preview(row);
                }
            }, 150);
        }
    });

    // Show dialog
    d.show();

    // Initial preview render after dialog layout is drawn
    setTimeout(() => {
        update_preview();
    }, 300);
}

function render_tspl_preview(container, template_doc, context) {
    container.innerHTML = "";
    
    // Scale mm to pixels (e.g. 1mm = 4.5px) for display
    let scale = 4.5;
    let width_mm = template_doc.label_width || 50;
    let height_mm = template_doc.label_height || 30;
    
    let width_px = width_mm * scale;
    let height_px = height_mm * scale;
    
    container.style.width = width_px + "px";
    container.style.height = height_px + "px";
    container.style.position = "relative";
    container.style.border = "1px solid #333";
    container.style.backgroundColor = "#fff";
    container.style.boxShadow = "0 6px 12px rgba(0,0,0,0.15)";
    container.style.margin = "0 auto";
    container.style.overflow = "hidden";

    // Substitute context in TSPL lines
    let substituted = template_doc.raw_tspl || "";
    for (let key in context) {
        let val = context[key] !== undefined && context[key] !== null ? context[key] : "";
        let regex = new RegExp("{{\\s*" + key + "\\s*}}", "g");
        substituted = substituted.replace(regex, val);
    }
    
    let lines = substituted.split("\n");
    lines.forEach(line => {
        line = line.trim();
        if (line.startsWith("TEXT")) {
            // Format: TEXT x,y,"font",rotation,x_mul,y_mul,"content"
            let match = line.match(/TEXT\s+(\d+)\s*,\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"([^"]*)"/);
            if (match) {
                let x_mm = parseFloat(match[1]) / 8;
                let y_mm = parseFloat(match[2]) / 8;
                
                let left_px = x_mm * scale;
                let top_px = y_mm * scale;
                let text = match[7];
                
                let el = document.createElement("div");
                el.style.position = "absolute";
                el.style.left = left_px + "px";
                el.style.top = top_px + "px";
                el.style.fontFamily = "monospace";
                el.style.fontSize = "12px";
                el.style.fontWeight = "bold";
                el.style.color = "#000";
                el.style.lineHeight = "1";
                el.style.whiteSpace = "nowrap";
                el.innerText = text;
                
                container.appendChild(el);
            }
        } else if (line.startsWith("BARCODE")) {
            // Format: BARCODE x,y,"code_type",height,human,rotation,narrow,wide,"content"
            let match = line.match(/BARCODE\s+(\d+)\s*,\s*(\d+)\s*,\s*"([^"]+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*"([^"]*)"/);
            if (match) {
                let x_mm = parseFloat(match[1]) / 8;
                let y_mm = parseFloat(match[2]) / 8;
                let height_mm = parseFloat(match[4]) / 8;
                
                let left_px = x_mm * scale;
                let top_px = y_mm * scale;
                let barcode_height_px = height_mm * scale;
                let barcode_type = match[3];
                let text = match[9];
                let show_human = parseInt(match[5]) === 1;
                
                let svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.style.position = "absolute";
                svg.style.left = left_px + "px";
                svg.style.top = top_px + "px";
                container.appendChild(svg);
                
                try {
                    if (text && text.trim() !== "") {
                        JsBarcode(svg, text, {
                            format: barcode_type === "128" ? "CODE128" : "CODE39",
                            height: barcode_height_px,
                            width: 1.2,
                            displayValue: show_human,
                            margin: 0,
                            fontSize: 10,
                            font: "monospace"
                        });
                    } else {
                        // Show placeholder
                        svg.innerHTML = `<rect width="100" height="${barcode_height_px}" fill="#eee" stroke="#ccc"></rect>
                                         <text x="10" y="${barcode_height_px/2 + 3}" font-family="monospace" font-size="9" fill="#999">[No Barcode Value]</text>`;
                    }
                } catch (e) {
                    console.error("Barcode rendering error:", e);
                }
            }
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
