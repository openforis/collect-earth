var SEPARATOR_MULTIPLE_PARAMETERS = "===";
var SEPARATOR_MULTIPLE_VALUES = ";";
var DATE_FORMAT = 'MM/DD/YYYY';
var TIME_FORMAT = 'HH:ss';

//To be used by the method that saves the data automatically when the user
//interacts with the form
//DO NOT REMOVE
var ajaxTimeout = null;

$(document)
	.ready(function() {
		fillYears();
		initializeDateTimePickers();

		// Declares the Jquery Dialog ( The Bootstrap dialog does
		// not work in Google Earth )
		$("#dialogSuccess").dialog({
			modal : true,
			autoOpen : false,
			buttons : {
				Ok : function() {
					$(this).dialog("close");
				}
			}
		});
		// SAVING DATA WHEN USER SUBMITS
		$('#formAll').submit(
			function(e) {
				e.preventDefault();
				
				clearTimeout(ajaxTimeout); // So that the form
				// is not saved twice
				// if the user
				// clicks the submit
				// button before the
				// auto-save timeout
				// has started
				
				// Mark this as the "real submit" (as opposed
				// when saving data just because the user closes
				// the window) so we can show the placemark as
				// interpreted
				$("input[id=collect_boolean_actively_saved]")
					.val("true");
				
				submitForm($(this), 0);
			});
		
		//http://jqueryui.com/tooltip/
		$(document).tooltip({
			 show: null,
			 position: {
				 my: "left top",
				 at: "left bottom"
			 },
			 open: function( event, ui ) {
				 ui.tooltip.animate({ top: ui.tooltip.position().top + 10 }, "fast" );
			 }
		 });
		
		checkIfPlacemarkAlreadyFilled('#formAll', 0);
});

var ajaxDataUpdate = function() {

	var actively_saved = $("input[id=collect_boolean_actively_saved]").val();
	// Only update automatically when the data has not been correctly saved
	// before
	if (actively_saved == 'false') {
		// Set a two second timeout so that the data is only sent to the server
		// if the user stops clicking for over one second
		clearTimeout(ajaxTimeout);
		ajaxTimeout = setTimeout(function() {
			var $form = $("#formAll");
			var data = serializeForm("formAll");
			$.ajax({
				data : data,
				type : $form.attr("method"),
				url : $form.attr("action"),
				dataType : 'json'
			})
			.done(function(json) {
				interpretJsonSaveResponse(json, actively_saved);
			});
		}, 100);
	}
};
	
var submitForm = function($form, submitCounter) {
	var $form = $("#formAll");
	var data = serializeForm("formAll");
	var request = $
		.ajax({
			data : data,
			type : $form.attr("method"),
			url : $form.attr("action"),
			dataType : 'json',
			timeout : 5000,
			beforeSend : function() {
				$.blockUI({
					message : 'Sumitting data..'
				});
			}
		})
		.done(function(json) {
			interpretJsonSaveResponse(json, true);
		})
		.fail(function(jqXHR, textStatus, errorThrown) {
			if (submitCounter < 3) {
				submitForm($form, submitCounter + 1);
			} else {
				$('#succ_mess')
						.css("color", "red")
						.html("Cannot save the data, the Collect Earth server is not running! ");
				$("#dialogSuccess").dialog("open");
			}
		})
		.always(function() {
			$.unblockUI();
		});
}

var interpretJsonSaveResponse = function(json, activelySaved) {
	if (activelySaved) {
		if (json.type == 'warning') {
			$('#succ_mess').css("color", "yellow").html(json.message);
		} else if (json.type == 'success' && json.valid_data
				&& json.valid_data == 'false') {
			
			var message = "";
			
			$.each(json, function(key, info) {
				if (info.inError) {
					message += info.errorMessage + "<br>";
				}
			});
			showMessage(message, true);
			
			// Resest the "actively saved" parameter to false so that it is not sent
			// aw true when the user fixes the validation
			$("input[id=collect_boolean_actively_saved]").val('false');
			
		} else if (json.type == 'success') {
			showMessage(json.message);
			forceWindowCloseAfterDialogCloses($("#dialogSuccess"));
		} else if (json.type == 'error') {
			showMessage(json.message, true);
		}
	}
	
	//update possible values in SELECT elements
	$.each(json.inputFieldInfoByParameterName, function(fieldName, info) {
		var el = $("#" + fieldName);
		if (el && el.length == 1 && el[0].nodeName == "SELECT") {
			var oldValue = el.val();
			var possibleItems = info.possibleCodedItems ? info.possibleCodedItems: [];
			OF.UI.Forms.populateSelect(el, possibleItems, "code", "label");
			el.val(oldValue);
			if (el.val() == null) {
				el.val("-1");
			}
		}
	});
	//update errors feedback
	var errors = [];
	$.each(json.inputFieldInfoByParameterName, function(fieldName, info) {
		if (info.inError) {
			errors.push({field: fieldName, defaultMessage: info.errorMessage});
		}
	});
	OF.UI.Forms.Validation.updateErrors($("#formAll"), errors);
	
	//manage fields visibility
	$.each(json.inputFieldInfoByParameterName, function(fieldName, info) {
		var field = $("#" + fieldName);
		var formGroup = field.closest( '.form-group' );
		formGroup.toggle(info.visible);
	});
};

var serializeForm = function(formId) {
	return $("#" + formId).serialize();
};

var enableSelect = function(selectName, enable) { // #elementsCover
	if (enable == true) {
		$(selectName).prop('disabled', false);
	} else {
		$(selectName).prop('disabled', true);
	}
	// $(selectName).selectpicker('refresh');
};

var initializeDateTimePickers = function() {
	//http://eonasdan.github.io/bootstrap-datetimepicker/
	$('.datepicker').datetimepicker({
	   format: DATE_FORMAT
	})
	.on('dp.change', function(e) {
//		var inputField = $(this).find(".form-control");
//		inputField.change();
		ajaxDataUpdate();
	});
	
	$('.timepicker').datetimepicker({
	   format: TIME_FORMAT
	})
	.on('dp.change', function(e) {
		ajaxDataUpdate();
	});
};

var checkIfPlacemarkAlreadyFilled = function(formName, chechCount) {

	var data = $(formName + " :input[value]").serialize();
	
	$.ajax({
			data : data,
			type : "POST",
			//url : "$[host]placemarkInfo",
			 url: "http://127.0.0.1:8028/earth/placemarkInfo",
			dataType : 'json',
			timeout : 5000
		})
		.fail(
			function(jqXHR, textStatus, errorThrown) {
				if (chechCount < 3) {
					chechCount = chechCount + 1;
					checkIfPlacemarkAlreadyFilled(formName, chechCount);
				} else {
					showMessage("The Collect Earth server is not running!");
					initializeChangeEventSaver();
				}
		})
		.done(
			function(json) {
				if (json.collect_boolean_actively_saved == 'true'
						&& json.collect_text_id != 'testPlacemark') { // 

					showMessage("The data for this placemark has already been filled", true);

					if (json.earth_skip_filled
							&& json.earth_skip_filled == 'true') {
						forceWindowCloseAfterDialogCloses($("#dialogSuccess"));
					}
				}
				// Pre-fills the form and after that initilizes the
				// change event listeners for the inputs
				fillDataWithJson(json);
				initializeChangeEventSaver();
		});
};

var showMessage = function(message, error) {
	var color = error ? "red": "green";
	$('#succ_mess')
		.css("color", color)
		.html(message);
	$("#dialogSuccess").dialog("open");	
};

var fillDataWithJson = function(json) {
	$.each(
		json,
		function(key, value) {
			// Do this for every key there might be different
			// tryopes of elements with the same key than a hidden
			// input
			if ($("input[name=\'" + key + "\']").length == 1) {
				var values = value.split(SEPARATOR_MULTIPLE_VALUES); // In
																		// case
																		// of
																		// value
																		// being
																		// 0;collect_code_deforestation_reason=burnt
				$("input[name=\'" + key + "\']").val(values[0]);
			}

			if ($("textarea[name=\'" + key + "\']").length == 1) {
				$("textarea[name=\'" + key + "\']").val(value);
			} else if ($("select[name=\'" + key + "\']").length == 1) {
				var values = value
						.split(SEPARATOR_MULTIPLE_PARAMETERS);
			/* 	$("select[name=\'" + key + "\']").selectpicker(
						'val', values); */
				
				$("select[name=\'" + key + "\']").val(value);
			
			} else if ($('#' + key + '_group').length == 1) { // button
																// group
																// exists
				var values = value
						.split(SEPARATOR_MULTIPLE_PARAMETERS);
				for (var i = 0; i < values.length; i++) {
					// $('#'+key+'_group
					// .btn[value='+value+']').button('toggle'); //
					// set the class to "active" on the chosen
					// values
					if ($('#' + key + '_group .btn[value=\''
							+ value + '\']').length == 1) {
						var toggleButton = $('#' + key
								+ '_group .btn[value=\'' + value
								+ '\']');
						toggleButton.button('toggle');
						if (key == "collect_code_land_use_category") {
							activateLandUseDivs(toggleButton.val());
						}
					}
				}
			} else if ($('.landUseTypeSelector .btn[value=\''
					+ value + '\']').length == 1) {
				var toggleButton = $('.landUseTypeSelector .btn[value=\''
						+ value + '\']');
				toggleButton.button('toggle');
			} else if ($("select[name=\'hidden_" + key + "\']").length == 1) {
				var values = value
						.split(SEPARATOR_MULTIPLE_PARAMETERS);
				/* $("select[name=\'hidden_" + key + "\']")
						.selectpicker('val', values); */
			/* 	$("select[name=\'hidden_" + key + "\'] option").filter(function() {
				    //may want to use $.trim in here
					var inArray = $.inArray( $(this).text(), values );
				    return inArray>=0; 
				}).prop('selected', true); */
				$("select[name=\'hidden_" + key + "\']").val(values);
				
			}

			if (key == "earth_skip_filled" && value == 'true') {
				$('#earth_skip_filled').attr('checked', value);
			}

		});
}

var initializeChangeEventSaver = function() {
	$(".btn").click(function() {
		var groupId = $(this).closest("div .btn-group").attr("id");

		var suffixLength = "_group".length;
		if (groupId && groupId.length > suffixLength) {
			var value = $(this).val();
			// When we expect data sucha as
			// "0;collect_code_deforestation_reason=burnt"
			var values = value.split(SEPARATOR_MULTIPLE_VALUES);

			var idLength = groupId.length - suffixLength;
			var hiddenInputId = groupId.substring(0, idLength);
			$('#' + hiddenInputId).val(values[0]);// give the hidden input the
													// same value as the button
													// that just was clicked

			if ($('.' + hiddenInputId + '_dependant').length > 0) {
				var dependants = $('.' + hiddenInputId + '_dependant:hidden');
				resetDependants(hiddenInputId);
			}

			// If there is an extra value
			// "collect_code_deforestation_reason=burnt"
			if (values.length == 2) {
				var extraValues = values[1].split("=");
				$('#' + extraValues[0]).val(extraValues[1]);
			}
		}
		ajaxDataUpdate();
	});

	// SAVING DATA WHEN DATA CHANGES
	// Bind event to Before user leaves page with function parameter e
	// The window onbeforeunload or onunload events do not work in Google Earth
	// OBS! The change event is not fired for the hidden inputs when the value
	// is updated through jQuery's val()
	$('input[name^=collect], select[name^=collect],select[name^=hidden], button[name^=collect]')
		.change(function(e) {
			ajaxDataUpdate();
	});

	$('input:text[name^=collect], textarea[name^=collect]').keyup(function(e) {
		ajaxDataUpdate(1500);
	});
}

var fillYears = function() {
	for (var year = new Date().getFullYear(); year > 1980; year--) {
		$('.fillYears').each(function() {
			$(this).append(
				$("<option></option>")
					.attr("value", year)
						.text(year));
			});
	}
};

var forceWindowCloseAfterDialogCloses = function($dialog) {
	$dialog.on("dialogclose", function(event, ui) {
		window.open("#$[next_id];flyto"); // balloonFlyto - annoying to have
											// the balloon open, doesn't let you
											// see the plot
	});
};

