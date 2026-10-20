package org.openforis.collect.earth.core.handlers;

import java.math.BigDecimal;

import org.openforis.idm.metamodel.NodeDefinition;
import org.openforis.idm.metamodel.NumericAttributeDefinition.Type;
import org.openforis.idm.metamodel.RangeAttributeDefinition;
import org.openforis.idm.model.IntegerRange;
import org.openforis.idm.model.NumericRange;
import org.openforis.idm.model.RealRange;
import org.springframework.stereotype.Component;

/**
 * Range attributes, integer ("integer_range_" parameters) or real ("real_range_"). The balloon value is "FROM-TO", or a
 * single number for a range of one value; negative numbers keep their sign ("-5--2").
 *
 * @author Alfonso Sanchez-Paus Diaz
 *
 */
@Component
public class RangeAttributeHandler extends AbstractAttributeHandler<NumericRange<?>> {

	private static final String INTEGER_PREFIX = "integer_range_";
	private static final String REAL_PREFIX = "real_range_";

	private final Type type;

	public RangeAttributeHandler() {
		this(Type.INTEGER);
	}

	public RangeAttributeHandler(Type type) {
		super(type == Type.REAL ? REAL_PREFIX : INTEGER_PREFIX);
		this.type = type;
	}

	@Override
	public String getParameterValue(NumericRange<?> value) {
		if (value == null || value.getFrom() == null) {
			return null;
		}
		String from = format(value.getFrom());
		// Written without spaces : that is what createValue reads ( toInternalString gives "1 - 5", which the parsers refuse )
		return value.getTo() == null || value.getTo().equals(value.getFrom()) ? from : from + "-" + format(value.getTo());
	}

	private static String format(Number number) {
		return number instanceof Double ? BigDecimal.valueOf((Double) number).stripTrailingZeros().toPlainString()
				: number.toString();
	}

	@Override
	public NumericRange<?> createValue(String parameterValue) {
		// "10 - 20" as typed, and the decimal comma of a real range ( the separator is a dash, so a comma is never one )
		String value = parameterValue.replaceAll("\\s", "");
		NumericRange<?> range = type == Type.REAL ? RealRange.parseRealRange(value.replace(',', '.'), null)
				: IntegerRange.parseIntegerRange(value, null);
		if (range == null) {
			// Thrown, as the number handlers do, so that the value is kept and the interpreter is told on the field
			throw new NumberFormatException("Parameter value '" + parameterValue + "' is not a range");
		}
		return range;
	}

	@Override
	public boolean isParseable(NodeDefinition def) {
		return def instanceof RangeAttributeDefinition && ((RangeAttributeDefinition) def).getType() == type;
	}

}
