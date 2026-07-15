frappe.listview_settings['Printer Profile'] = {
    add_fields: ['is_active'],
    get_indicator: function(doc) {
        if (doc.is_active) {
            return [__("Active"), "green", "is_active,=,1"];
        } else {
            return [__("Inactive"), "gray", "is_active,=,0"];
        }
    }
};
